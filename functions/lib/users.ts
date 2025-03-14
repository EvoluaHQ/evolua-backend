import {
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ServiceException } from "@smithy/smithy-client";
import { MaxScansExceededError } from "../types/errors";
import { documentClient, usersTableName } from "./dynamodb-helper";

const USERS_TABLE_NAME = usersTableName();

export interface User {
  id: string;
  email: string;
  username: string;
  imageUrl: string;
  clerkUserId: string;
  firstName: string;
  lastName: string;
  githubHandle?: string;
  createdAt: string;
  lastUpdatedAt: string;
  deleted: boolean;
  tier: "FREE" | "PRO";
  billingStartDate: string;
  freeTrialStartDate: string;
  freeTrialEndDate: string;
  scanCount: number;
}

export async function findUserByClerkUserId(
  clerkUserId?: string
): Promise<User | null> {
  if (!clerkUserId) {
    return null;
  }

  const { Items } = await documentClient.send(
    new QueryCommand({
      TableName: USERS_TABLE_NAME,
      IndexName: "clerkUserIdIndex",
      KeyConditionExpression: "clerkUserId = :clerkUserId",
      ExpressionAttributeValues: {
        ":clerkUserId": clerkUserId,
      },
    })
  );

  return (Items?.[0] as User) || null;
}

export async function findUserByEmail(email?: string): Promise<User | null> {
  if (!email) {
    return null;
  }

  const { Items } = await documentClient.send(
    new QueryCommand({
      TableName: USERS_TABLE_NAME,
      IndexName: "emailIndex",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
    })
  );

  return (Items?.[0] as User) || null;
}

export async function findUserByGithubHandle(
  githubHandle?: string
): Promise<User | null> {
  if (!githubHandle) {
    return null;
  }

  const { Items } = await documentClient.send(
    new QueryCommand({
      TableName: USERS_TABLE_NAME,
      IndexName: "githubHandleIndex",
      KeyConditionExpression: "githubHandle = :githubHandle",
      ExpressionAttributeValues: {
        // github handles are always lowercase
        ":githubHandle": githubHandle.toLowerCase(),
      },
    })
  );

  return (Items?.[0] as User) || null;
}

export async function findUser(
  clerkUserId?: string,
  email?: string,
  githubHandle?: string
) {
  const [byClerkId, byEmail, byGhHandle] = await Promise.all([
    findUserByClerkUserId(clerkUserId),
    findUserByEmail(email),
    findUserByGithubHandle(githubHandle),
  ]);

  return byClerkId || byEmail || byGhHandle;
}

export async function upsertUser(user: User) {
  await documentClient.send(
    new PutCommand({
      TableName: USERS_TABLE_NAME,
      Item: {
        ...user,
        deleted: false,
      },
    })
  );
}

export async function deleteUser(id: string) {
  await documentClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE_NAME,
      Key: {
        id,
      },
      UpdateExpression:
        "SET deleted = :deleted, lastUpdatedAt = :lastUpdatedAt",
      ExpressionAttributeValues: {
        ":deleted": true,
        ":lastUpdatedAt": new Date().toISOString(),
      },
    })
  );
}

export async function incrementScanCount(id: string, maxScans: number) {
  try {
    const response = await documentClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: { id },
        UpdateExpression: "SET scanCount = scanCount + 1",
        ReturnValues: "UPDATED_NEW",
        ConditionExpression: "scanCount < :maxScans + 1",
        ExpressionAttributeValues: {
          ":maxScans": maxScans,
        },
      })
    );

    return response.Attributes?.scanCount;
  } catch (error) {
    if (
      error instanceof ServiceException &&
      error.name === "ConditionalCheckFailedException"
    ) {
      throw new MaxScansExceededError(
        `User ${id} has reached the maximum number of scans (${maxScans})`
      );
    }
    throw error;
  }
}

export async function setUserTier(id: string, tier: "FREE" | "PRO") {
  await documentClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE_NAME,
      Key: {
        id,
      },
      UpdateExpression: "SET tier = :tier, lastUpdatedAt = :lastUpdatedAt",
      ExpressionAttributeValues: {
        ":tier": tier,
        ":lastUpdatedAt": new Date().toISOString(),
      },
      ConditionExpression: "attribute_exists(id)",
    })
  );
}

export async function resetScanCount(id: string) {
  await documentClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE_NAME,
      Key: {
        id,
      },
      UpdateExpression: "SET scanCount = :zero",
      ExpressionAttributeValues: {
        ":zero": 0,
      },
      ConditionExpression: "attribute_exists(id)",
    })
  );
}

export async function getAllUsers(): Promise<User[]> {
  let lastEvaluatedKey: any = undefined;
  const users: User[] = [];

  do {
    const { Items, LastEvaluatedKey } = await documentClient.send(
      new ScanCommand({
        TableName: USERS_TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (Items) {
      users.push(...(Items as User[]));
    }

    lastEvaluatedKey = LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return users;
}
