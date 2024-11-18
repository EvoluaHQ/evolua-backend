const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const Ulid = require('ulid');

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const tenantReposTableName = 'EvoluaDataStack-dev-TenantReposTable14FAF19D-1HBBGGMDV5R6E';

const repoIdToTenantRepoId = {};

// recursively scan all items in the tenantRepos table
async function updateRepos() {
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

        for (const tenantRepo of result.Items) {
          if (tenantRepo.tenantRepoId) {
            continue;
          }

          const repoId = tenantRepo.repoId;
          const tenantRepoId = repoIdToTenantRepoId[repoId] || Ulid.ulid();

          // update the tenantRepo item with the tenantRepoId
          const updateParams = {
            TableName: tenantReposTableName,
            Key: {
              tenantId: tenantRepo.tenantId,
              repoId: tenantRepo.repoId
            },
            UpdateExpression: 'SET tenantRepoId = :tenantRepoId',
            ExpressionAttributeValues: {
              ':tenantRepoId': tenantRepoId
            }
          };
          await DocumentClient.send(new UpdateCommand(updateParams));

          repoIdToTenantRepoId[repoId] = tenantRepoId;          
        }
    } while (lastEvaluatedKey);    
}

updateRepos()
.then(() => console.log('done'))
.catch(console.error);
