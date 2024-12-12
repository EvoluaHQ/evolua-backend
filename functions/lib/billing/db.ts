// src/lib/db.ts

import { DynamoDB } from "aws-sdk";
import { BillingServiceError } from "./errors";
import { BillingInterval, BillingStatus, Organization } from "./types";

/**
 * DynamoDB table names
 */
const TABLES = {
  ORGANIZATIONS: process.env.ORGANIZATIONS_TABLE!,
  SUBSCRIPTIONS: process.env.SUBSCRIPTIONS_TABLE!,
} as const;

/**
 * DynamoDB client configuration
 */
const dynamodb = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION,
  maxRetries: 3,
  convertEmptyValues: true,
});

/**
 * Interface for organization updates
 * Makes all fields optional and adds validation types
 */
interface OrganizationUpdate {
  name?: string;
  email?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  billingStatus?: BillingStatus;
  currentPeriodEnd?: number;
  priceId?: string;
  billingInterval?: BillingInterval;
  totalSeats?: number;
  activeSeats?: number;
  maxMembers?: number;
  billingEmail?: string;
  paymentMethodId?: string;
  trialEndsAt?: number;
}

/**
 * Retrieves an organization by its ID
 * Uses consistent read for accuracy during billing operations
 */
export async function getOrganization(
  organizationId: string
): Promise<Organization | null> {
  try {
    const result = await dynamodb
      .get({
        TableName: TABLES.ORGANIZATIONS,
        Key: { id: organizationId },
        ConsistentRead: true, // Ensure we get the latest data for billing operations
      })
      .promise();

    return (result.Item as Organization) || null;
  } catch (error) {
    console.error("Failed to get organization:", error);
    throw new BillingServiceError(
      "Failed to retrieve organization",
      "database_error",
      500,
      error as Error
    );
  }
}

/**
 * Retrieves an organization by its Clerk ID
 * Uses GSI for efficient lookup
 */
export async function getOrganizationByClerkId(
  clerkOrgId: string
): Promise<Organization | null> {
  try {
    const result = await dynamodb
      .query({
        TableName: TABLES.ORGANIZATIONS,
        IndexName: "ClerkOrgIdIndex",
        KeyConditionExpression: "clerkOrgId = :clerkOrgId",
        ExpressionAttributeValues: { ":clerkOrgId": clerkOrgId },
      })
      .promise();

    return (result.Items?.[0] as Organization) || null;
  } catch (error) {
    console.error("Failed to get organization by Clerk ID:", error);
    throw new BillingServiceError(
      "Failed to retrieve organization by Clerk ID",
      "database_error",
      500,
      error as Error
    );
  }
}

/**
 * Retrieves an organization by its Stripe customer ID
 * Uses GSI for efficient lookup
 */
export async function getOrganizationByStripeCustomerId(
  stripeCustomerId: string
): Promise<Organization | null> {
  try {
    const result = await dynamodb
      .query({
        TableName: TABLES.ORGANIZATIONS,
        IndexName: "StripeCustomerIndex",
        KeyConditionExpression: "stripeCustomerId = :stripeCustomerId",
        ExpressionAttributeValues: { ":stripeCustomerId": stripeCustomerId },
      })
      .promise();

    return (result.Items?.[0] as Organization) || null;
  } catch (error) {
    console.error("Failed to get organization by Stripe customer ID:", error);
    throw new BillingServiceError(
      "Failed to retrieve organization by Stripe customer ID",
      "database_error",
      500,
      error as Error
    );
  }
}

/**
 * Updates an organization with partial data
 * Handles attribute updates and expressions automatically
 */
export async function updateOrganization(
  organizationId: string,
  updates: OrganizationUpdate
): Promise<Organization> {
  try {
    // Filter out undefined values
    const filteredUpdates = Object.entries(updates).reduce(
      (acc, [key, value]) =>
        value !== undefined ? { ...acc, [key]: value } : acc,
      {}
    );

    // Generate update expression and attribute names/values
    const updateExpression =
      "set updatedAt = :updatedAt, " +
      Object.keys(filteredUpdates)
        .map((key) => `#${key} = :${key}`)
        .join(", ");

    const expressionAttributeNames = Object.keys(filteredUpdates).reduce(
      (acc, key) => ({ ...acc, [`#${key}`]: key }),
      {}
    );

    const expressionAttributeValues = {
      ...Object.entries(filteredUpdates).reduce(
        (acc, [key, value]) => ({ ...acc, [`:${key}`]: value }),
        {}
      ),
      ":updatedAt": Date.now(),
    };

    const result = await dynamodb
      .update({
        TableName: TABLES.ORGANIZATIONS,
        Key: { id: organizationId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
        // Add condition to ensure organization exists
        ConditionExpression: "attribute_exists(id)",
      })
      .promise();

    if (!result.Attributes) {
      throw new BillingServiceError("Organization not found", "not_found", 404);
    }

    return result.Attributes as Organization;
  } catch (error) {
    // Handle specific DynamoDB errors
    if (error.code === "ConditionalCheckFailedException") {
      throw new BillingServiceError("Organization not found", "not_found", 404);
    }

    console.error("Failed to update organization:", error);
    throw new BillingServiceError(
      "Failed to update organization",
      "database_error",
      500,
      error as Error
    );
  }
}

/**
 * Creates a new organization
 * Ensures uniqueness of organization ID and Clerk ID
 */
export async function createOrganization(
  organization: Organization
): Promise<Organization> {
  try {
    await dynamodb
      .put({
        TableName: TABLES.ORGANIZATIONS,
        Item: {
          ...organization,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        // Ensure neither ID exists already
        ConditionExpression:
          "attribute_not_exists(id) AND attribute_not_exists(clerkOrgId)",
      })
      .promise();

    return organization;
  } catch (error) {
    if (error.code === "ConditionalCheckFailedException") {
      throw new BillingServiceError(
        "Organization already exists",
        "already_exists",
        409
      );
    }

    console.error("Failed to create organization:", error);
    throw new BillingServiceError(
      "Failed to create organization",
      "database_error",
      500,
      error as Error
    );
  }
}

/**
 * Batch retrieves organizations
 * Useful for admin operations or reporting
 */
export async function batchGetOrganizations(
  organizationIds: string[]
): Promise<Organization[]> {
  try {
    // DynamoDB batch get has a limit of 100 items
    const BATCH_SIZE = 100;
    const batches = [];

    // Split IDs into batches
    for (let i = 0; i < organizationIds.length; i += BATCH_SIZE) {
      const batch = organizationIds.slice(i, i + BATCH_SIZE);
      batches.push(batch);
    }

    // Process each batch
    const results = await Promise.all(
      batches.map((batchIds) =>
        dynamodb
          .batchGet({
            RequestItems: {
              [TABLES.ORGANIZATIONS]: {
                Keys: batchIds.map((id) => ({ id })),
              },
            },
          })
          .promise()
      )
    );

    // Combine results
    return results
      .flatMap((result) => result.Responses?.[TABLES.ORGANIZATIONS] || [])
      .filter(Boolean) as Organization[];
  } catch (error) {
    console.error("Failed to batch get organizations:", error);
    throw new BillingServiceError(
      "Failed to retrieve organizations",
      "database_error",
      500,
      error as Error
    );
  }
}
