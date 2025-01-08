import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { BillingStatus, BillingInterval } from '../types';
import { documentClient, subscriptionsTableName } from './dynamodb-helper';

export interface Subscription {
  subId: string;
  createdAt: string;
  lastUpdatedAt: string;
  type: "personal" | "organization";
  userId?: string;
  orgId?: string;
  status: BillingStatus;
  billingInterval: BillingInterval;
}

export async function createSubscription(subscription: Subscription): Promise<void> {
  await documentClient.send(new PutCommand({
    TableName: subscriptionsTableName(),
    Item: subscription
  }));
}

export async function updateSubscriptionBillingInfo(
  subId: string, 
  subscriptionStatus: BillingStatus,
  billingInterval: BillingInterval
): Promise<void> {
  await documentClient.send(new UpdateCommand({
    TableName: subscriptionsTableName(),
    Key: {
      subId
    },
    UpdateExpression: 'SET lastUpdatedAt = :lastUpdatedAt, #status = :status, billingInterval = :billingInterval',
    ExpressionAttributeNames: {
      '#status': 'status'
    },
    ExpressionAttributeValues: {
      ':lastUpdatedAt': new Date().toJSON(),
      ':status': subscriptionStatus,
      ':billingInterval': billingInterval
    }
  }));
}

export async function getSubscription(subId: string): Promise<Subscription | null> {
  const resp = await documentClient.send(new GetCommand({
    TableName: subscriptionsTableName(),
    Key: {
      subId
    }
  }));

  return resp.Item as Subscription | null;
}
