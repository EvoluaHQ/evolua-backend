import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { documentClient, organizationsTableName } from './dynamodb-helper';

export interface Organization {
  orgId: string;
  name: string;
  clerkOrgId: string;
  createdAt: string;
  lastUpdatedAt: string;
  maxMembers: number;
  deleted: boolean;
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
        TableName: organizationsTableName(),
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
      TableName: organizationsTableName(),
      Key: {
        orgId,
        sk: 'ORGANIZATION'
      }
    })
  );

  return resp.Item as Organization | null;
}

export async function putOrganization(organization: Organization): Promise<void> {
  await documentClient.send(new PutCommand({
    TableName: organizationsTableName(),
    Item: {
      ...organization,
      sk: 'ORGANIZATION'
    }
  }));
}
