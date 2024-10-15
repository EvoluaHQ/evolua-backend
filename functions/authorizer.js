const jwt = require('jsonwebtoken')
const { Logger } = require('@aws-lambda-powertools/logger')

const logger = new Logger()

// move this to secure location
const publicKey = `get it from a secure location`

/**
 * @param {import('aws-lambda').AppSyncAuthorizerEvent} event 
 */
module.exports.handler = async (event) => {
  const token = getToken(event.authorizationToken);

  const claims = jwt.verify(token, publicKey)

  logger.debug('Verified claims', { claims })

  return {
    isAuthorized: true,
    resolverContext: {
    }
  };
}

const getToken = (jwtToken) => {
  const match = jwtToken.match(/^Bearer (.*)$/);
  if (!match || match.length < 2) {
    throw new Error(`Invalid Authorization token - ${jwtToken} does not match "Bearer .*"`);
  }

  return match[1];
}