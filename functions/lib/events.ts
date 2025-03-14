import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { documentClient } from "../lib/dynamodb-helper";
import { Metadata } from "../types/eventbridge";

const ebClient = new EventBridgeClient({});

interface EventDetail {
  metadata: Metadata;
  data: any;
}

export const publishEvent = async (
  eventId: string,
  source: string,
  eventType: string,
  data: any,
  idempotencyKey?: string
): Promise<void> => {
  const detail: EventDetail = {
    metadata: {
      eventId,
      version: "1",
      timestamp: new Date().toISOString(),
      source,
      type: eventType,
      idempotencyKey,
    },
    data,
  };

  const command = new PutEventsCommand({
    Entries: [
      {
        Source: source,
        DetailType: eventType,
        Detail: JSON.stringify(detail),
        EventBusName: process.env.EVENTBUS_NAME,
      },
    ],
  });
  await ebClient.send(command);
};

export const saveEvent = async (
  eventId: string,
  source: string,
  eventType: string,
  data: any,
  idempotencyKey?: string
): Promise<void> => {
  const command = new PutCommand({
    TableName: process.env.EVENTS_TABLE_NAME,
    Item: {
      eventId,
      source,
      eventType,
      idempotencyKey,
      data,
    },
  });
  await documentClient.send(command);
};
