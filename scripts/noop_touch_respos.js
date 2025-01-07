const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const tenantReposTableName = 'EvoluaDataStack-dev-TenantReposTable14FAF19D-1HBBGGMDV5R6E';
const now = new Date().toJSON();

async function updateScans() {
    let lastEvaluatedKey;
    do {
        let cmd;
        if (lastEvaluatedKey) {
          cmd = new ScanCommand({
            TableName: tenantReposTableName,
            ExclusiveStartKey: lastEvaluatedKey
          });
        } else {
          cmd = new ScanCommand({
            TableName: tenantReposTableName
          });
        }

        const result = await DocumentClient.send(cmd);

        lastEvaluatedKey = result.LastEvaluatedKey;

        for (const scan of result.Items) {
          const updateParams = {
            TableName: tenantReposTableName,
            Key: {
              repoId: scan.repoId,
              tenantId: scan.tenantId
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
