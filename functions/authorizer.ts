import { verify, TokenExpiredError, JwtPayload } from "jsonwebtoken";
import { Logger } from "@aws-lambda-powertools/logger";
import { AppSyncAuthorizerEvent, AppSyncAuthorizerResult } from "aws-lambda";
import { findUserByClerkUserId } from "./lib/users";

const logger = new Logger()

// move this to secure location
const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuLt73jz+9/nGhangwk8R
s7qVdLrYsrcCsIkl00QJYY/45pdhpFpgD39wPeDDx/Wmkis2F3MvASV0V4SAnswn
QmpmmmjKAB/aEZKDNxIxRZtrMn6y4bTtD09JKk1MP0e6Nzv3ZN0Vmhl8/lU1Bj9P
jurDV095Z9pT3meokf3z02G+BwPhDrT8mzR9rVZ7CVQMiUeETiAKjBDn89/XmclS
uX1vVpROKaemTWB1RFXF4HGPw9A6N2bp71jqBhaxG8rj2byLEJytw1FjM8XhzOIG
uureAfLhU/zWxqMMGwh0O2Ub/CQpiOo/cAYHzapG+NEx74A9y/AvtPbLBbMmwTog
mQIDAQAB
-----END PUBLIC KEY-----`

type ResolverContext = {
  tenantId: string
}

type Result = AppSyncAuthorizerResult<ResolverContext>

export const handler = async (event: AppSyncAuthorizerEvent): Promise<Result> => {
  try {
    const token = getToken(event.authorizationToken);
  
    const claims = verify(token, publicKey) as JwtPayload;

    logger.debug('Verified claims', { claims })
    const clerkUserId = claims.sub
    const user = await findUserByClerkUserId(clerkUserId)

    if (!user) {
      logger.warn('User not found', { clerkUserId });
      
      return {
        isAuthorized: false
      }
    }

    return {
      isAuthorized: true,
      resolverContext: {
        tenantId: user.id
      }
    };
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      logger.warn('Token expired');

      return {
        isAuthorized: false
      }
    } else {
      logger.error('Authorizer error', err as Error);

      return {
        isAuthorized: false
      }
    }
  }
}

const getToken = (jwtToken: string) => {
  const match = jwtToken.match(/^Bearer (.*)$/);
  if (!match || match.length < 2) {
    throw new Error(`Invalid Authorization token - ${jwtToken} does not match "Bearer .*"`);
  }

  return match[1];
}