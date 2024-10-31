import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import * as helper from './dynamodb-helper';

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const REPOS_TABLE_NAME = process.env.REPOS_TABLE_NAME || '';
if (!REPOS_TABLE_NAME) {
  throw new Error('REPOS_TABLE_NAME env var is missing');
}

export interface Repo {
  provider: string;
  providerId: string;
  name: string;
  fullName: string;
  private: boolean;
}

export async function enableReposForTenant(tenantId: string, repos: Repo[]) {
  const allRequests = repos.map(repo => ({
    PutRequest: {
      Item: {
        pk: `TENANT#${tenantId}`,
        sk: `REPO#${repo.provider}#${repo.providerId}`,
        tenantId,
        provider: repo.provider,
        providerId: repo.providerId
      }
    }
  }));

  await helper.executeBatchWriteCommand(DocumentClient, REPOS_TABLE_NAME, allRequests);
}

export async function saveRepos(repos: Repo[]) {
  const allRequests = repos.map(repo => ({
    PutRequest: {
      Item: {
        pk: 'REPO',
        sk: `${repo.provider}#${repo.providerId}`,
        provider: repo.provider,
        providerId: repo.providerId,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private
      }
    }
  }));

  await helper.executeBatchWriteCommand(DocumentClient, REPOS_TABLE_NAME, allRequests);
}

export async function deleteRepos(repos: Repo[]) {
  const allRequests = repos.map(repo => ({
    DeleteRequest: {
      Key: {
        pk: 'REPO',
        sk: `${repo.provider}#${repo.providerId}`
      }
    }
  }));

  await helper.executeBatchWriteCommand(DocumentClient, REPOS_TABLE_NAME, allRequests);
}
