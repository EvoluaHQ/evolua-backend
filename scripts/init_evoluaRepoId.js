const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand, 
  GetCommand
} = require("@aws-sdk/lib-dynamodb");
const Ulid = require('ulid');

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const tenantReposTableName = 'EvoluaDataStack-dev-TenantReposTable14FAF19D-1HBBGGMDV5R6E';
const reposTableName = 'EvoluaDataStack-dev-ReposTable1EB2A097-F79GQBVPP66I';

const repoIdToEvoluaRepoId = {};

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
          if (tenantRepo.evoluaRepoId) {
            continue;
          }

          const repoId = tenantRepo.repoId;
          const evoluaRepoId = repoIdToEvoluaRepoId[repoId] || Ulid.ulid();

          // update the tenantRepo item with the evoluaRepoId
          const updateParams = {
            TableName: tenantReposTableName,
            Key: {
              tenantId: tenantRepo.tenantId,
              repoId: tenantRepo.repoId
            },
            UpdateExpression: 'SET evoluaRepoId = :evoluaRepoId',
            ExpressionAttributeValues: {
              ':evoluaRepoId': evoluaRepoId
            }
          };
          await DocumentClient.send(new UpdateCommand(updateParams));

          repoIdToEvoluaRepoId[repoId] = evoluaRepoId;

          // get the repo item from the repos table
          const getRepoResult = await DocumentClient.send(new GetCommand({
            TableName: reposTableName,
            Key: {
              repoId: repoId
            }
          }));

          if (getRepoResult.Item) {
            // update the repo item with the evoluaRepoId
            const updateRepoParams = {
              TableName: reposTableName,
              Key: {
                repoId: repoId
              },
              UpdateExpression: 'SET evoluaRepoId = :evoluaRepoId',
              ExpressionAttributeValues: {
                ':evoluaRepoId': evoluaRepoId
              }
            };
            await DocumentClient.send(new UpdateCommand(updateRepoParams));
          }
        }
    } while (lastEvaluatedKey);    
}

updateRepos()
.then(() => console.log('done'))
.catch(console.error);
