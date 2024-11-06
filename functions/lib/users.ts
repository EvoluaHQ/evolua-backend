import { DynamoDB } from "@aws-sdk/client-dynamodb"
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb"

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
}

export async function findUserByClerkUserId(
  clerkUserId: string
): Promise<User | null> {
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

export async function findUserByEmail(email: string): Promise<User | null> {
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

export async function findUserByGithubHandle(
  githubHandle: string
): Promise<User | null> {
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
  clerkUserId: string,
  email: string,
  githubHandle: string
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
