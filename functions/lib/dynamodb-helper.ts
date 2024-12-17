import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { 
  DynamoDBDocumentClient, 
  BatchWriteCommand, 
  BatchGetCommand
} from "@aws-sdk/lib-dynamodb";

const dynamodbClient = new DynamoDB()
export const documentClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: {
    // Automatically removes undefined values
    // Otherwise, DynamoDB client can throw error
    // "Pass options.removeUndefinedValues=true to remove undefined values from map/array/set."
    removeUndefinedValues: true,
  },
})

// DynamoDB's batch operations also allow this many items in a batch
const BATCH_SIZE = 25;

export async function executeBatchWriteCommand(tableName: string, allRequests: any[]) {
  const batches = [];

  for (let i = 0; i < allRequests.length; i += BATCH_SIZE) {
    const requests = allRequests.slice(i, i + BATCH_SIZE);
    const batch = documentClient.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: requests
      }
    }));
    batches.push(batch);
  }

  await Promise.all(batches);
}

export async function executeBatchGetCommand(tableName: string, keys: any[]) {
  const batches = [];

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const requests = keys.slice(i, i + BATCH_SIZE);
    const batch = documentClient.send(new BatchGetCommand({
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
  const tableName = process.env.REPOS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("REPOS_TABLE_NAME env var is missing")
  }

  return tableName;
}

export const usersTableName = () => {
  const tableName = process.env.USERS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("USERS_TABLE_NAME env var is missing")
  }

  return tableName;
}

export const organizationsTableName = () => {
  const tableName = process.env.ORGANIZATIONS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("ORGANIZATIONS_TABLE_NAME env var is missing")
  }

  return tableName;
}

export const subscriptionsTableName = () => {
  const tableName = process.env.STRIPE_SUBSCRIPTIONS_TABLE_NAME || ""

  if (!tableName) {
    throw new Error("STRIPE_SUBSCRIPTIONS_TABLE_NAME env var is missing")
  }

  return tableName;
}
