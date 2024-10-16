const events = require('./lib/events');
const ulid = require('ulid');
const { Webhooks } = require('@octokit/webhooks');
const middy = require('@middy/core');
const ssm = require('@middy/ssm');

const { SSM_STAGE_NAME } = process.env;

/**
 * @param {import('aws-lambda').APIGatewayEvent} event 
 */
const handler = async (event, context) => {
  const webhooks = new Webhooks({
    secret: context.GITHUB_SECRET,
  });

  const signature = event.headers["X-Hub-Signature-256"];
  if (!(await webhooks.verify(event.body, signature))) {
    return {
      statusCode: 401
    };
  }

  const payload = event.body ? JSON.parse(event.body) : {};
  const eventId = ulid.ulid();

  await events.publishEvent(eventId, 'github', 'webhook', payload);
  await events.saveEvent('default-tenant', eventId, 'github', 'webhook', payload);

  return {
    statusCode: 200
  };
}

module.exports.handler = middy(handler)
.use(ssm({
  cache: true,
  cacheExpiry: 5 * 60 * 1000, // 5 mins
  setToContext: true,
  fetchData: {
    GITHUB_SECRET: `/evolua/${SSM_STAGE_NAME}/github/secret`
  }
}))
