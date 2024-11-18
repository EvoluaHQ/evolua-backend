import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import * as helper from './dynamodb-helper';
import * as Ulid from 'ulid';

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
  const TENANT_REPOS_TABLE_NAME = process.env.TENANT_REPOS_TABLE_NAME || '';
  if (!TENANT_REPOS_TABLE_NAME) {
    throw new Error('TENANT_REPOS_TABLE_NAME env var is missing');
  }

  const allRequests = repos.map(repo => ({
    PutRequest: {
      Item: {
        tenantId,
        repoId: `${repo.provider}#${repo.providerRepoId}`,
        provider: repo.provider,
        providerRepoId: repo.providerRepoId,
        tenantRepoId: Ulid.ulid(),
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private
      }
    }
  }));

  await helper.executeBatchWriteCommand(DocumentClient, TENANT_REPOS_TABLE_NAME, allRequests);
}

export async function saveRepos(repos: Repo[]) {
  const REPOS_TABLE_NAME = process.env.REPOS_TABLE_NAME || '';
  if (!REPOS_TABLE_NAME) {
    throw new Error('REPOS_TABLE_NAME env var is missing');
  }

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

  await helper.executeBatchWriteCommand(DocumentClient, REPOS_TABLE_NAME, allRequests);
}

export async function deleteRepos(repoIds: string[]) {
  const REPOS_TABLE_NAME = process.env.REPOS_TABLE_NAME || '';
  if (!REPOS_TABLE_NAME) {
    throw new Error('REPOS_TABLE_NAME env var is missing');
  }

  const allRequests = repoIds.map(repoId => ({
    DeleteRequest: {
      Key: {
        repoId
      }
    }
  }));

  await helper.executeBatchWriteCommand(DocumentClient, REPOS_TABLE_NAME, allRequests);
}

export async function listReposForTenant(tenantId: string): Promise<TenantRepo[]> {
  const TENANT_REPOS_TABLE_NAME = process.env.TENANT_REPOS_TABLE_NAME || '';
  if (!TENANT_REPOS_TABLE_NAME) {
    throw new Error('TENANT_REPOS_TABLE_NAME env var is missing');
  }

  const params = {
    TableName: TENANT_REPOS_TABLE_NAME,
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
