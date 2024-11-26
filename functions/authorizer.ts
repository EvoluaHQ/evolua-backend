import { verify, TokenExpiredError, JwtPayload } from "jsonwebtoken";
import { Logger } from "@aws-lambda-powertools/logger";
import { AppSyncAuthorizerEvent, AppSyncAuthorizerResult } from "aws-lambda";
import { findUserByClerkUserId } from "./lib/users";
import middy from '@middy/core';
import ssm from '@middy/ssm';

const logger = new Logger()

const { SSM_STAGE_NAME } = process.env;

type ResolverContext = {
  clerkUserId: string
  tenantId: string
}

type Result = AppSyncAuthorizerResult<ResolverContext>

const _handler = async (event: AppSyncAuthorizerEvent, context: any): Promise<Result> => {
  try {
    const token = getToken(event.authorizationToken);
  
    const claims = verify(token, context.CLERK_PUBLIC_KEY) as JwtPayload;

    logger.debug('Verified claims', { claims })
    if (!claims.sub) {
      logger.warn('Invalid claim, "sub" (i.e. clerk user id) not found', { claims });

      return {
        isAuthorized: false
      }
    }

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
        clerkUserId,
        tenantId: user.id,
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

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      CLERK_PUBLIC_KEY: `/evolua/${SSM_STAGE_NAME}/clerk/public-key`
    }
  }));