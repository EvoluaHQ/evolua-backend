import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { documentClient, organizationsTableName, executeBatchGetCommand } from './dynamodb-helper';

const ORGANIZATIONS_TABLE_NAME = organizationsTableName();

export interface Organization {
  orgId: string;
  name: string;
  clerkOrgId: string;
  createdAt: string;
  lastUpdatedAt: string;
  maxMembers: number;
  status: "active" | "inactive" | "suspended";
}

export interface OrganizationMember {
  orgId: string;
  clerkOrgId: string;
  role: "admin" | "member";
  clerkUserId: string;
  createdAt: string;
}

export async function addOrganization(organization: Organization, admin: OrganizationMember): Promise<void> {
  await documentClient.send(new TransactWriteCommand({
    TransactItems: [{
      Put: {
        TableName: ORGANIZATIONS_TABLE_NAME,
        Item: {
          ...organization,
          sk: 'ORGANIZATION'
        }
      }
    }, {
      Put: {
        TableName: organizationsTableName(),
        Item: {
          ...admin,
          sk: `MEMBER#${admin.clerkUserId}`
        }
      }
    }]
  }));
}

export async function getOrganizationById(orgId: string): Promise<Organization | null> {
  const resp = await documentClient.send(
    new GetCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      Key: {
        orgId,
        sk: 'ORGANIZATION'
      }
    })
  );

  return resp.Item as Organization | null;
}

export async function getOrganizationsByIds(orgIds: string[]): Promise<Organization[]> {
  const tableName = organizationsTableName();

  const allKeys = orgIds.map(orgId => ({
    orgId,
    sk: 'ORGANIZATION'
  }));

  const resp = await executeBatchGetCommand(tableName, allKeys);

  return resp.map(item => item as Organization)
}

export async function putOrganization(organization: Organization): Promise<void> {
  await documentClient.send(new PutCommand({
    TableName: ORGANIZATIONS_TABLE_NAME,
    Item: {
      ...organization,
      sk: 'ORGANIZATION'
    }
  }));
}

export async function findOrganizationByClerkOrgId(clerkOrgId: string): Promise<Organization | null> {
  const { Items } = await documentClient.send(
    new QueryCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      IndexName: "clerkOrgIdIndex",
      KeyConditionExpression: "clerkOrgId = :clerkOrgId and sk = :sk",
      ExpressionAttributeValues: {
        ":clerkOrgId": clerkOrgId,
        ":sk": "ORGANIZATION"
      },
    })
  );

  return (Items?.[0] as Organization) || null;
}

export async function findOrganizationMembershipsByClerkUserId(clerkUserId: string): Promise<OrganizationMember[]> {
  const tableName = organizationsTableName();

  const params = {
    TableName: tableName,
    IndexName: 'clerkUserIdIndex',
    KeyConditionExpression: "clerkUserId = :clerkUserId",
      ExpressionAttributeValues: {
        ":clerkUserId": clerkUserId,
      },
  };

  let items: OrganizationMember[] = [];
  let lastEvaluatedKey: any;

  do {
    const data = await documentClient.send(new QueryCommand({
      ...params,
      ExclusiveStartKey: lastEvaluatedKey
    }));

    items.push(...data.Items as OrganizationMember[]);
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}
