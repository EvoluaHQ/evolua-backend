import { 
  DynamoDBDocumentClient, 
  BatchWriteCommand, 
  BatchGetCommand
} from "@aws-sdk/lib-dynamodb";

// DynamoDB's batch operations also allow this many items in a batch
const BATCH_SIZE = 25;

export async function executeBatchWriteCommand(
  documentclient: DynamoDBDocumentClient, tableName: string, allRequests: any[]
) {
  const batches = [];

  for (let i = 0; i < allRequests.length; i += BATCH_SIZE) {
    const requests = allRequests.slice(i, i + BATCH_SIZE);
    const batch = documentclient.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: requests
      }
    }));
    batches.push(batch);
  }

  await Promise.all(batches);
}

export async function executeBatchGetCommand(
  documentclient: DynamoDBDocumentClient, tableName: string, keys: any[]
) {
  const batches = [];

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const requests = keys.slice(i, i + BATCH_SIZE);
    const batch = documentclient.send(new BatchGetCommand({
      RequestItems: {
        [tableName]: {
          Keys: requests
        }
      }
    }));
    batches.push(batch);
  }

  const responses = await Promise.all(batches);
  return responses.flatMap(response => response.Responses![tableName]);
}

export const scansTableName = () => {
  const tableName = process.env.SCANS_TABLE_NAME || ""
  if (!tableName) {
    throw new Error("SCANS_TABLE_NAME env var is missing")
  }

  return tableName;
}

export const scanResultsTableName = () => {
  const tableName = process.env.SCAN_RESULTS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("SCAN_RESULTS_TABLE_NAME env var is missing")
  }

  return tableName;
}

export const tenantReposTableName = () => {
  const tableName = process.env.TENANT_REPOS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("TENANT_REPOS_TABLE_NAME env var is missing")
  }

  return tableName;
}

export const reposTableName = () => {
  const tableName = process.env.TENANT_REPOS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("TENANT_REPOS_TABLE_NAME env var is missing")
  }

  return tableName;
}
