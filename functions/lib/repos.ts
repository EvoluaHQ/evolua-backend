import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import {
  documentClient,
  executeBatchGetCommand,
  executeBatchWriteCommand,
  reposTableName,
  tenantReposTableName,
} from "./dynamodb-helper";

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

  const allRequests = repos.map((repo) => ({
    PutRequest: {
      Item: {
        tenantId,
        repoId: `${repo.provider}#${repo.providerRepoId}`,
        provider: repo.provider,
        providerRepoId: repo.providerRepoId,
        tenantRepoId: ulid(),
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
      },
    },
  }));

  await executeBatchWriteCommand(tableName, allRequests);
}

export async function saveRepos(repos: Repo[]) {
  const tableName = reposTableName();

  const allRequests = repos.map((repo) => ({
    PutRequest: {
      Item: {
        repoId: `${repo.provider}#${repo.providerRepoId}`,
        provider: repo.provider,
        providerRepoId: repo.providerRepoId,
        name: repo.name,
        private: repo.private,
      },
    },
  }));

  await executeBatchWriteCommand(tableName, allRequests);
}

export async function deleteRepos(repoIds: string[]) {
  const tableName = reposTableName();

  const allRequests = repoIds.map((repoId) => ({
    DeleteRequest: {
      Key: {
        repoId,
      },
    },
  }));

  await executeBatchWriteCommand(tableName, allRequests);
}

export async function getRepo(repoId: string): Promise<Repo | undefined> {
  const tableName = reposTableName();

  const resp = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { repoId },
    })
  );

  return resp.Item as Repo | undefined;
}

export async function batchGetRepos(
  repoIds: string[]
): Promise<(Repo & { repoId: string })[]> {
  const tableName = reposTableName();

  const allKeys = repoIds.map((repoId) => ({
    repoId,
  }));

  const resp = await executeBatchGetCommand(tableName, allKeys);

  return resp.map((item) => item as Repo & { repoId: string });
}

export async function listReposForTenant(
  tenantId: string
): Promise<TenantRepo[]> {
  const tableName = tenantReposTableName();

  const params = {
    TableName: tableName,
    KeyConditionExpression: "tenantId = :tenantId",
    ExpressionAttributeValues: {
      ":tenantId": tenantId,
    },
  };

  let items: TenantRepo[] = [];
  let lastEvaluatedKey: any;

  do {
    const data = await documentClient.send(
      new QueryCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    items = items.concat(data.Items as TenantRepo[]);
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

export async function getTenantRepo(
  tenantId: string,
  tenantRepoId: string
): Promise<TenantRepo | null> {
  const tableName = tenantReposTableName();

  const queryResp = await documentClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "tenantRepoIdIndex",
      Limit: 1,
      KeyConditionExpression:
        "tenantId = :tenantId AND tenantRepoId = :tenantRepoId",
      ExpressionAttributeValues: {
        ":tenantId": tenantId,
        ":tenantRepoId": tenantRepoId,
      },
    })
  );

  if (!queryResp.Items || queryResp.Items.length === 0) {
    return null;
  }

  return queryResp.Items[0] as TenantRepo;
}

export async function getTenantRepoByRepoId(
  tenantId: string,
  repoId: string
): Promise<TenantRepo | null> {
  const tableName = tenantReposTableName();

  const getResp = await documentClient.send(
    new GetCommand({
      TableName: tableName,
      Key: {
        tenantId,
        repoId,
      },
    })
  );

  return getResp.Item as TenantRepo;
}

export async function deleteTenantRepo(tenantId: string, repoId: string) {
  const tableName = tenantReposTableName();

  await documentClient.send(
    new DeleteCommand({
      TableName: tableName,
      Key: {
        tenantId,
        repoId,
      },
    })
  );
}

export async function updateLastReviewedAt(repoId: string, timestamp: Date) {
  const tableName = reposTableName();

  await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { repoId },
      UpdateExpression: "SET lastReviewedAt = :lastReviewedAt",
      ExpressionAttributeValues: {
        ":lastReviewedAt": timestamp.toJSON(),
      },
    })
  );
}

export async function updateTenantRepoLastReviewedAt(
  tenantId: string,
  repoId: string,
  lastReviewedAt: string
) {
  const tableName = tenantReposTableName();

  await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        tenantId,
        repoId,
      },
      UpdateExpression: "SET lastReviewedAt = :lastReviewedAt",
      ExpressionAttributeValues: {
        ":lastReviewedAt": lastReviewedAt,
      },
    })
  );
}

export async function findTenantReposByRepoId(
  repoId: string
): Promise<TenantRepo[]> {
  const tableName = tenantReposTableName();

  const params = {
    TableName: tableName,
    IndexName: "repoIdIndex",
    KeyConditionExpression: "repoId = :repoId",
    ExpressionAttributeValues: {
      ":repoId": repoId,
    },
  };

  let items: TenantRepo[] = [];
  let lastEvaluatedKey: any;

  do {
    const data = await documentClient.send(
      new QueryCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    items.push(...(data.Items as TenantRepo[]));
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}
