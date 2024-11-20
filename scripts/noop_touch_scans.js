const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const Ulid = require('ulid');

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const scansTableName = 'EvoluaDataStack-dev-ScansTableF3C3406E-183ZITJQDDPSY';
const now = new Date().toJSON();

async function updateScans() {
    let lastEvaluatedKey;
    do {
        let cmd;
        if (lastEvaluatedKey) {
          cmd = new ScanCommand({
            TableName: scansTableName,
            ExclusiveStartKey: lastEvaluatedKey
          });
        } else {
          cmd = new ScanCommand({
            TableName: scansTableName
          });
        }

        const result = await DocumentClient.send(cmd);

        lastEvaluatedKey = result.LastEvaluatedKey;

        for (const scan of result.Items) {
          const updateParams = {
            TableName: scansTableName,
            Key: {
              repoId: scan.repoId,
              scanId: scan.scanId
            },
            UpdateExpression: 'SET noop_touched = :now',
            ExpressionAttributeValues: {
              ':now': now
            }
          };
          await DocumentClient.send(new UpdateCommand(updateParams));
        }
    } while (lastEvaluatedKey);    
}

updateScans()
.then(() => console.log('done'))
.catch(console.error);
