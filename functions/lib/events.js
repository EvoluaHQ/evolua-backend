const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const ddb = require("@aws-sdk/lib-dynamodb");
const events = require('@aws-sdk/client-eventbridge');

const dynamodbClient = new DynamoDB();
const dynamodb = ddb.DynamoDBDocumentClient.from(dynamodbClient);
const ebClient = new events.EventBridgeClient();

const { EVENT_BUS_NAME, EVENTS_TABLE_NAME } = process.env;

const publishEvent = async (eventId, source, eventType, data) => {
  const detail = {
    metadata: {
      eventId,
      version: '1',
      timestamp: new Date().toISOString(),
      source,
      type: eventType,
    },
    data
  };
  
  const command = new events.PutEventsCommand({
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

const saveEvent = async (tenantId, eventId, source, eventType, data) => {
  const command = new ddb.PutCommand({
    TableName: EVENTS_TABLE_NAME,
    Item: {
      tenantId,
      eventId,
      source,
      eventType,
      data
    }
  });
  await dynamodb.send(command);
}

module.exports = {
  publishEvent,
  saveEvent
};
