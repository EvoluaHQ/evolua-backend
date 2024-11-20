const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  UpdateCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const tenantReposTableName = 'EvoluaDataStack-dev-TenantReposTable14FAF19D-1HBBGGMDV5R6E';
const reposTableName = 'EvoluaDataStack-dev-ReposTable1EB2A097-F79GQBVPP66I';

const repoLastReviewedAt = {};

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
          let lastReviewedAt = repoLastReviewedAt[tenantRepo.repoId];

          if (lastReviewedAt === undefined) {
            const getResp = await DocumentClient.send(new GetCommand({
              TableName: reposTableName,
              Key: { 
                repoId: tenantRepo.repoId
              }
            }))

            if (getResp.Item?.lastReviewedAt) {
              lastReviewedAt = getResp.Item.lastReviewedAt;
            } else {
              repoLastReviewedAt[tenantRepo.repoId] = null;
            }
          }

          if (lastReviewedAt) {
            const updateParams = {
              TableName: tenantReposTableName,
              Key: {
                tenantId: tenantRepo.tenantId,
                repoId: tenantRepo.repoId
              },
              UpdateExpression: 'SET lastReviewedAt = :lastReviewedAt',
              ExpressionAttributeValues: {
                ':lastReviewedAt': lastReviewedAt
              }
            };
            await DocumentClient.send(new UpdateCommand(updateParams));

            repoLastReviewedAt[tenantRepo.repoId] = lastReviewedAt;
          }

        }
    } while (lastEvaluatedKey);    
}

updateRepos()
.then(() => console.log('done'))
.catch(console.error);
