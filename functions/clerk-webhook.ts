import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import * as Events from './lib/events';

export const handler = async (event: APIGatewayEvent): Promise<APIGatewayProxyResult> => {
  const payload = event.body ? JSON.parse(event.body) : {};
  const eventType = payload.type || 'unknown';

  const eventId = ulid();

  await Events.publishEvent(eventId, 'clerk', eventType, payload);
  await Events.saveEvent(eventId, 'clerk', eventType, payload);

  return {
    statusCode: 200,
    body: ""
  };
};
