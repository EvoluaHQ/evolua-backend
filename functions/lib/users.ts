import { DynamoDB } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb"
import { ServiceException } from "@smithy/smithy-client"
import { MaxScansExceededError } from '../types/errors'

const dynamodbClient = new DynamoDB()
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient)

const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME || ""
if (!USERS_TABLE_NAME) {
  throw new Error("USERS_TABLE_NAME env var is missing")
}

export interface User {
  id: string
  email: string
  username: string
  imageUrl: string
  clerkUserId: string
  firstName: string
  lastName: string
  githubHandle?: string
  createdAt: string
  lastUpdatedAt: string
  deleted: boolean
  tier: string
  billingStartDate: string
  scanCount: number
  maxScans: number
}

export async function findUserByClerkUserId(clerkUserId?: string): Promise<User | null> {
  if (!clerkUserId) {
    return null
  }

  const { Items } = await DocumentClient.send(
    new QueryCommand({
      TableName: USERS_TABLE_NAME,
      IndexName: "clerkUserIdIndex",
      KeyConditionExpression: "clerkUserId = :clerkUserId",
      ExpressionAttributeValues: {
        ":clerkUserId": clerkUserId,
      },
    })
  )

  return (Items?.[0] as User) || null
}

export async function findUserByEmail(email?: string): Promise<User | null> {
  if (!email) {
    return null
  }

  const { Items } = await DocumentClient.send(
    new QueryCommand({
      TableName: USERS_TABLE_NAME,
      IndexName: "emailIndex",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
    })
  )

  return (Items?.[0] as User) || null
}

export async function findUserByGithubHandle(githubHandle?: string): Promise<User | null> {
  if (!githubHandle) {
    return null
  }

  const { Items } = await DocumentClient.send(
    new QueryCommand({
      TableName: USERS_TABLE_NAME,
      IndexName: "githubHandleIndex",
      KeyConditionExpression: "githubHandle = :githubHandle",
      ExpressionAttributeValues: {
        ":githubHandle": githubHandle,
      },
    })
  )

  return (Items?.[0] as User) || null
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
  ])

  return byClerkId || byEmail || byGhHandle
}

export async function upsertUser(user: User) {
  await DocumentClient.send(
    new PutCommand({
      TableName: USERS_TABLE_NAME,
      Item: {
        ...user,
        deleted: false,
      },
    })
  )
}

export async function deleteUser(id: string) {
  await DocumentClient.send(
    new UpdateCommand({
      TableName: USERS_TABLE_NAME,
      Key: {
        id,
      },
      UpdateExpression:
        "SET deleted = :deleted, lastUpdatedAt = :lastUpdatedAt",
      ExpressionAttributeValues: {
        ":deleted": true,
        lastUpdatedAt: new Date().toISOString(),
      },
    })
  )
}

export async function incrementScanCount(id: string) {
  try {
    await DocumentClient.send(
      new UpdateCommand({
        TableName: USERS_TABLE_NAME,
        Key: {
          id,
        },
        UpdateExpression: "ADD scanCount :one",
        ExpressionAttributeValues: {
          ":one": 1
        },
        ConditionExpression: "attribute_exists(id) AND scanCount < maxScans",
      })
    )
  } catch (err) {
    if (err instanceof ServiceException && err.name === "ConditionalCheckFailedException") {
      throw new MaxScansExceededError("Scan limit exceeded")
    } else {
      throw err
    }
  }
}

export async function resetScanCount(id: string) {
  await DocumentClient.send(
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
  )
}

export async function getAllUsers(): Promise<User[]> {
  let lastEvaluatedKey: any = undefined
  const users: User[] = []

  do {
    const { Items, LastEvaluatedKey } = await DocumentClient.send(
      new ScanCommand({
        TableName: USERS_TABLE_NAME,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    )

    if (Items) {
      users.push(...(Items as User[]))
    }

    lastEvaluatedKey = LastEvaluatedKey
  } while (lastEvaluatedKey)

  return users
}
