import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const dynamodbClient = new DynamoDB({});
const dynamodb = DynamoDBDocumentClient.from(dynamodbClient);
const ebClient = new EventBridgeClient({});

const { EVENT_BUS_NAME, EVENTS_TABLE_NAME } = process.env;

interface EventDetail {
  metadata: {
    eventId: string;
    version: string;
    timestamp: string;
    source: string;
    type: string;
  };
  data: any;
}

export const publishEvent = async (eventId: string, source: string, eventType: string, data: any): Promise<void> => {
  const detail: EventDetail = {
    metadata: {
      eventId,
      version: '1',
      timestamp: new Date().toISOString(),
      source,
      type: eventType,
    },
    data
  };
  
  const command = new PutEventsCommand({
    Entries: [
      {
        Source: source,
        DetailType: eventType,
        Detail: JSON.stringify(detail),
        EventBusName: EVENT_BUS_NAME,
      }
    ]
  });
  await ebClient.send(command);
}

export const saveEvent = async (eventId: string, source: string, eventType: string, data: any): Promise<void> => {
  const command = new PutCommand({
    TableName: EVENTS_TABLE_NAME,
    Item: {
      eventId,
      source,
      eventType,
      data
    }
  });
  await dynamodb.send(command);
}
