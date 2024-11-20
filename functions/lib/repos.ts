import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from 'ulid';
import { 
  reposTableName,
  tenantReposTableName,
  executeBatchWriteCommand,
  executeBatchGetCommand
} from './dynamodb-helper';

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

export interface Repo {
  provider: string;
  providerRepoId: string;
  name: string;
  fullName: string;
  private: boolean;
}

export interface TenantRepo {
  tenantId: string;
  repoId: string;
  provider: string;
  providerRepoId: string;
  name: string;
  fullName: string;
  private: boolean;
  tenantRepoId: string;
}

export async function enableReposForTenant(tenantId: string, repos: Repo[]) {
  const tableName = tenantReposTableName();

  const allRequests = repos.map(repo => ({
    PutRequest: {
      Item: {
        tenantId,
        repoId: `${repo.provider}#${repo.providerRepoId}`,
        provider: repo.provider,
        providerRepoId: repo.providerRepoId,
        tenantRepoId: ulid(),
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private
      }
    }
  }));

  await executeBatchWriteCommand(DocumentClient, tableName, allRequests);
}

export async function saveRepos(repos: Repo[]) {
  const tableName = reposTableName();

  const allRequests = repos.map(repo => ({
    PutRequest: {
      Item: {
        repoId: `${repo.provider}#${repo.providerRepoId}`,
        provider: repo.provider,
        providerRepoId: repo.providerRepoId,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private
      }
    }
  }));

  await executeBatchWriteCommand(DocumentClient, tableName, allRequests);
}

export async function deleteRepos(repoIds: string[]) {
  const tableName = reposTableName();

  const allRequests = repoIds.map(repoId => ({
    DeleteRequest: {
      Key: {
        repoId
      }
    }
  }));

  await executeBatchWriteCommand(DocumentClient, tableName, allRequests);
}

export async function batchGetRepos(repoIds: string[]): Promise<(Repo & { repoId: string })[]> {
  const tableName = reposTableName();

  const allKeys = repoIds.map(repoId => ({
    repoId
  }));

  const resp = await executeBatchGetCommand(DocumentClient, tableName, allKeys);

  return resp.map(item => item as Repo & { repoId: string });
}

export async function listReposForTenant(tenantId: string): Promise<TenantRepo[]> {
  const tableName = tenantReposTableName();

  const params = {
    TableName: tableName,
    KeyConditionExpression: 'tenantId = :tenantId',
    ExpressionAttributeValues: {
      ':tenantId': tenantId
    }
  };

  let items: TenantRepo[] = [];
  let lastEvaluatedKey: any;

  do {
    const data = await DocumentClient.send(new QueryCommand({
      ...params,
      ExclusiveStartKey: lastEvaluatedKey
    }));

    items = items.concat(data.Items as TenantRepo[]);
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

export async function getTenantRepo(tenantId: string, tenantRepoId: string): Promise<TenantRepo | null> {
  const tableName = tenantReposTableName();

  const queryResp = await DocumentClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'tenantRepoIdIndex',
    Limit: 1,
    KeyConditionExpression: 'tenantId = :tenantId AND tenantRepoId = :tenantRepoId',
    ExpressionAttributeValues: {
      ':tenantId': tenantId,
      ':tenantRepoId': tenantRepoId
    }
  }));

  if (!queryResp.Items || queryResp.Items.length === 0) {
    return null;
  }

  return queryResp.Items[0] as TenantRepo;
}

export async function updateLastReviewedAt(repoId: string, timestamp: Date) {
  const tableName = reposTableName();

  await DocumentClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { repoId },
    UpdateExpression: 'SET lastReviewedAt = :lastReviewedAt',
    ExpressionAttributeValues: {
      ':lastReviewedAt': timestamp.toJSON()
    }
  }));
}

export async function updateTenantRepoLastReviewedAt(tenantId: string, repoId: string, lastReviewedAt: string) {
  const tableName = tenantReposTableName();

  await DocumentClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { 
      tenantId,
      repoId
    },
    UpdateExpression: 'SET lastReviewedAt = :lastReviewedAt',
    ExpressionAttributeValues: {
      ':lastReviewedAt': lastReviewedAt
    }
  }));
}

export async function findTenantReposByRepoId(repoId: string): Promise<TenantRepo[]> {
  const tableName = tenantReposTableName();

  const params = {
    TableName: tableName,
    IndexName: 'repoIdIndex',
    KeyConditionExpression: 'repoId = :repoId',
    ExpressionAttributeValues: {
      ':repoId': repoId
    }
  };

  let items: TenantRepo[] = [];
  let lastEvaluatedKey: any;

  do {
    const data = await DocumentClient.send(new QueryCommand({
      ...params,
      ExclusiveStartKey: lastEvaluatedKey
    }));

    items.push(...data.Items as TenantRepo[]);
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}
