import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  documentClient,
  executeBatchGetCommand,
  organizationsTableName,
} from "./dynamodb-helper";

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
  role: "admin" | "member" | "billing";
  clerkUserId: string;
  createdAt: string;
}

export async function addOrganization(
  organization: Organization,
  admin: OrganizationMember
): Promise<void> {
  await documentClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: ORGANIZATIONS_TABLE_NAME,
            Item: {
              ...organization,
              sk: "ORGANIZATION",
            },
          },
        },
        {
          Put: {
            TableName: ORGANIZATIONS_TABLE_NAME,
            Item: {
              ...admin,
              sk: `MEMBER#${admin.clerkUserId}`,
            },
          },
        },
      ],
    })
  );
}

export async function getOrganizationById(
  orgId: string
): Promise<Organization | null> {
  const resp = await documentClient.send(
    new GetCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      Key: {
        orgId,
        sk: "ORGANIZATION",
      },
    })
  );

  return resp.Item as Organization | null;
}

export async function getOrganizationByClerkOrgId(
  clerkOrgId: string
): Promise<Organization | null> {
  const { Items } = await documentClient.send(
    new QueryCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      IndexName: "clerkOrgIdIndex",
      KeyConditionExpression: "clerkOrgId = :clerkOrgId and sk = :sk",
      ExpressionAttributeValues: {
        ":clerkOrgId": clerkOrgId,
        ":sk": "ORGANIZATION",
      },
    })
  );

  return (Items?.[0] as Organization) || null;
}

export async function getOrganizationsByIds(
  orgIds: string[]
): Promise<Organization[]> {
  const keys = orgIds.map((orgId) => ({
    orgId,
    sk: "ORGANIZATION",
  }));

  const items = await executeBatchGetCommand(ORGANIZATIONS_TABLE_NAME, keys);
  return items as Organization[];
}

export async function putOrganization(
  organization: Organization
): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      Item: {
        ...organization,
        sk: "ORGANIZATION",
      },
    })
  );
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      Key: {
        orgId,
        sk: "ORGANIZATION",
      },
    })
  );
}

export async function getOrganizationMembers(
  orgId: string
): Promise<OrganizationMember[]> {
  let items: OrganizationMember[] = [];
  let lastEvaluatedKey: any;

  do {
    const { Items = [], LastEvaluatedKey } = await documentClient.send(
      new QueryCommand({
        TableName: ORGANIZATIONS_TABLE_NAME,
        KeyConditionExpression: "orgId = :orgId and begins_with(sk, :sk)",
        ExpressionAttributeValues: {
          ":orgId": orgId,
          ":sk": "MEMBER#",
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    items.push(...(Items as OrganizationMember[]));
    lastEvaluatedKey = LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

export async function putOrganizationMembership(
  member: OrganizationMember
): Promise<void> {
  await documentClient.send(
    new PutCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      Item: {
        ...member,
        sk: `MEMBER#${member.clerkUserId}`,
      },
    })
  );
}

export async function deleteOrganizationMembership(
  orgId: string,
  clerkUserId: string
): Promise<void> {
  await documentClient.send(
    new DeleteCommand({
      TableName: ORGANIZATIONS_TABLE_NAME,
      Key: {
        orgId,
        sk: `MEMBER#${clerkUserId}`,
      },
    })
  );
}

export async function findOrganizationMembershipsByClerkUserId(
  clerkUserId: string
): Promise<OrganizationMember[]> {
  let items: OrganizationMember[] = [];
  let lastEvaluatedKey: any;

  do {
    const data = await documentClient.send(
      new QueryCommand({
        TableName: ORGANIZATIONS_TABLE_NAME,
        IndexName: "clerkUserIdIndex",
        KeyConditionExpression: "clerkUserId = :clerkUserId",
        ExpressionAttributeValues: {
          ":clerkUserId": clerkUserId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    items.push(...(data.Items as OrganizationMember[]));
    lastEvaluatedKey = data.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}
