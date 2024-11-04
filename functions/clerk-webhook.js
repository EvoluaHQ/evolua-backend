const events = require('./lib/events');
const ulid = require('ulid');

/**
 * @param {import('aws-lambda').APIGatewayEvent} event 
 */
module.exports.handler = async (event) => {
  const payload = event.body ? JSON.parse(event.body) : {};
  const eventType = payload.type || 'unknown';

  const eventId = ulid.ulid();

  await events.publishEvent(eventId, 'clerk', eventType, payload);
  await events.saveEvent(eventId, 'clerk', eventType, payload);

  return {
    statusCode: 200
  };
}