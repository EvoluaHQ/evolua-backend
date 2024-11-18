const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const tenantReposTableName = 'EvoluaDataStack-dev-TenantReposTable14FAF19D-1HBBGGMDV5R6E';
const reposTableName = 'EvoluaDataStack-dev-ReposTable1EB2A097-F79GQBVPP66I';

// recursively scan all items in the tenantRepos table
async function updateTenantRepos() {
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
          if (!tenantRepo.providerId) {
            continue;
          }

          const providerRepoId = tenantRepo.providerId;

          // update the tenantRepo item with the providerRepoId
          const updateParams = {
            TableName: tenantReposTableName,
            Key: {
              tenantId: tenantRepo.tenantId,
              repoId: tenantRepo.repoId
            },
            UpdateExpression: 'SET providerRepoId = :providerRepoId REMOVE providerId',
            ExpressionAttributeValues: {
              ':providerRepoId': providerRepoId
            }
          };
          await DocumentClient.send(new UpdateCommand(updateParams));       
        }
    } while (lastEvaluatedKey);    
}

async function updateRepos() {
    let lastEvaluatedKey;
    do {
        let cmd;
        if (lastEvaluatedKey) {
          cmd = new ScanCommand({
            TableName: reposTableName,
            ExclusiveStartKey: lastEvaluatedKey
          });
        } else {
          cmd = new ScanCommand({
            TableName: reposTableName
          });
        }

        const result = await DocumentClient.send(cmd);

        lastEvaluatedKey = result.LastEvaluatedKey;

        for (const tenantRepo of result.Items) {
          if (!tenantRepo.providerId) {
            continue;
          }

          const providerRepoId = tenantRepo.providerId;

          // update the tenantRepo item with the providerRepoId
          const updateParams = {
            TableName: reposTableName,
            Key: {
              repoId: tenantRepo.repoId
            },
            UpdateExpression: 'SET providerRepoId = :providerRepoId REMOVE providerId',
            ExpressionAttributeValues: {
              ':providerRepoId': providerRepoId
            }
          };
          await DocumentClient.send(new UpdateCommand(updateParams));       
        }
    } while (lastEvaluatedKey);    
}

updateTenantRepos()
.then(() => console.log('done tenant repos'))
.catch(console.error);

updateRepos()
.then(() => console.log('done repos'))
.catch(console.error);
