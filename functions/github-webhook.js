const events = require('./lib/events');
const ulid = require('ulid');
const { Webhooks } = require('@octokit/webhooks');
const middy = require('@middy/core');
const ssm = require('@middy/ssm');
const { 
  GH_PR_ACTIONS,
  GH_INSTALL_ACTIONS
} = require('./lib/constants');

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

  let eventCategory = 'uncategorized';
  if (payload.pull_request && GH_PR_ACTIONS.includes(payload.action)) {
    eventCategory = 'pull_request';
  } else if (payload.installation && GH_INSTALL_ACTIONS.includes(payload.action)) {
    eventCategory = 'installation';
  }
  // there are other categories, such as "issues" and "security_advisory"
  // but we don't care about those for now

  const eventType = `${eventCategory}.${payload.action}`;

  await events.publishEvent(eventId, 'github', eventType, payload);
  await events.saveEvent(eventId, 'github', eventType, payload);

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
