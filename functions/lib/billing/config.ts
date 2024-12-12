// src/config.ts

import { createClerkClient } from "@clerk/backend";
import { DynamoDB } from "aws-sdk";
import Stripe from "stripe";
import { BillingErrors } from "./errors";

// Validate required environment variables
if (!process.env.CLERK_SECRET_KEY) {
  throw BillingErrors.configuration("CLERK_SECRET_KEY is not defined");
}

if (!process.env.STRIPE_SECRET_KEY) {
  throw BillingErrors.configuration("STRIPE_SECRET_KEY is not defined");
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
  throw BillingErrors.configuration("STRIPE_WEBHOOK_SECRET is not defined");
}

/**
 * Initialize Clerk client
 */
export const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

/**
 * Initialize Stripe client
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  typescript: true,
  maxNetworkRetries: 3, // Automatically retry failed requests
});

/**
 * Initialize DynamoDB client
 */
export const dynamodb = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
  maxRetries: 3,
});

/**
 * Application constants
 */
export const constants = {
  ORGANIZATIONS_TABLE: process.env.ORGANIZATIONS_TABLE!,
  FREE_TIER_USER_LIMIT: 2,
  TRIAL_DAYS: 14,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  // Price IDs for different billing intervals
  PRICE_CONFIG: {
    month: {
      id: process.env.STRIPE_PRICE_ID_MONTHLY!,
      interval: "month" as const,
      unitAmount: 14,
      name: "Pro Monthly",
    },
    year: {
      id: process.env.STRIPE_PRICE_ID_YEARLY!,
      interval: "year" as const,
      unitAmount: 120,
      name: "Pro Yearly",
    },
  },
} as const;

// Validate price configuration
if (!constants.PRICE_CONFIG.month.id || !constants.PRICE_CONFIG.year.id) {
  throw BillingErrors.configuration(
    "Stripe price IDs are not properly configured"
  );
}

if (!constants.ORGANIZATIONS_TABLE) {
  throw BillingErrors.configuration("ORGANIZATIONS_TABLE is not defined");
}

export default {
  clerk,
  stripe,
  dynamodb,
  constants,
};
