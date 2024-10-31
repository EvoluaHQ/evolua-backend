import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const USERS_TABLE_NAME = process.env.USERS_TABLE_NAME || '';
if (!USERS_TABLE_NAME) {
  throw new Error('USERS_TABLE_NAME is not set');
}

interface User {
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
}

async function findUserByClerkUserId(clerkUserId: string) {
  if (!clerkUserId) {
    return null;
  }

  const { Items } = await DocumentClient.send(new QueryCommand({
    TableName: USERS_TABLE_NAME,
    IndexName: 'clerkUserIdIndex',
    KeyConditionExpression: 'clerkUserId = :clerkUserId',
    ExpressionAttributeValues: {
      ':clerkUserId': clerkUserId,
    },
  }));
  
  return Items?.[0] || null;  
}

async function findUserByEmail(email: string) {
  const { Items } = await DocumentClient.send(new QueryCommand({
    TableName: USERS_TABLE_NAME,
    IndexName: 'emailIndex',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: {
      ':email': email,
    },
  }));
  
  return Items?.[0] || null;  
}

async function findUserByGithubHandle(githubHandle: string) {
  if (!githubHandle) {
    return null;
  }

  const { Items } = await DocumentClient.send(new QueryCommand({
    TableName: USERS_TABLE_NAME,
    IndexName: 'githubHandleIndex',
    KeyConditionExpression: 'githubHandle = :githubHandle',
    ExpressionAttributeValues: {
      ':githubHandle': githubHandle,
    },
  }));
  
  return Items?.[0] || null;  
}

export async function findUser(clerkUserId: string, email: string, githubHandle: string) {
  const [byClerkId, byEmail, byGhHandle] = await Promise.all([
    findUserByClerkUserId(clerkUserId),
    findUserByEmail(email),
    findUserByGithubHandle(githubHandle),
  ]);

  return byClerkId || byEmail || byGhHandle;
}

export async function saveUser(user: User) {
  await DocumentClient.send(new PutCommand({
    TableName: USERS_TABLE_NAME,
    Item: user,
  }));
}
