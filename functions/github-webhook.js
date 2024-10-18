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
  console.log('Received event:', JSON.stringify(event));

  const webhooks = new Webhooks({
    secret: context.GITHUB_SECRET,
  });

  const signature = event.headers["X-Hub-Signature-256"];
  console.log('Received signature:', signature);

  // Verify the signature
  if (!(await webhooks.verify(event.body, signature))) {
    console.warn('Unauthorized request: invalid signature');
    return {
      statusCode: 401,
      body: JSON.stringify({ message: 'Invalid signature' }),
    };
  }

  const payload = event.body ? JSON.parse(event.body) : {};
  console.log('Parsed payload:', payload);

  const eventId = ulid.ulid();
  console.log(`Generated event ID: ${eventId}`);

  // Publish and save the event
  try {
    await events.publishEvent(eventId, 'github', 'webhook', payload);
    console.log('Published event successfully');
  
    await events.saveEvent('default-tenant', eventId, 'github', 'webhook', payload);
    console.log('Saved event successfully');
  } catch (error) {
    console.error('Error processing event:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Webhook processed successfully' }),
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
  }));
