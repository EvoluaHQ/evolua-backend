const events = require('./lib/events');
const ulid = require('ulid');

/**
 * @param {import('aws-lambda').APIGatewayEvent} event 
 */
module.exports.handler = async (event) => {
  const payload = event.body ? JSON.parse(event.body) : {};
  const eventId = ulid.ulid();

  await events.publishEvent(eventId, 'clerk', 'webhook', payload);
  await events.saveEvent('default-tenant', eventId, 'clerk', 'webhook', payload);

  return {
    statusCode: 200
  };
}