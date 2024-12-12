// src/types/billing.ts
import { ClerkAPIError } from '@clerk/backend';
import Stripe from 'stripe';

/**
 * Core billing types for the application
 */

export type BillingInterval = 'month' | 'year';

export type BillingStatus = 
  | 'free' 
  | 'trialing' 
  | 'active' 
  | 'past_due' 
  | 'canceled' 
  | 'incomplete';

export interface BillingServiceError extends Error {
  code: string;
  statusCode: number;
  originalError?: Error | Stripe.StripeError | ClerkAPIError;
}

export interface PriceConfig {
  id: string;
  interval: BillingInterval;
  unitAmount: number;
  name: string;
  features: string[];
}

export interface Organization {
  id: string;
  name: string;
  email: string;
  clerkOrgId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  billingStatus: BillingStatus;
  currentPeriodEnd?: number;
  priceId?: string;
  billingInterval?: BillingInterval;
  totalSeats: number;
  activeSeats: number;
  maxMembers: number;
  billingEmail?: string;
  paymentMethodId?: string;
  trialEndsAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SubscriptionUpdateParams {
  organizationId: string;
  newSeatCount: number;
  billingInterval?: BillingInterval;
}

export interface CheckoutSessionParams {
  organizationId: string;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

// src/lib/errors.ts
/**
 * Custom error class for billing service
 * Provides structured error information including HTTP status codes
 */
export class BillingServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly originalError?: Error | Stripe.StripeError | ClerkAPIError
  ) {
    super(message);
    this.name = 'BillingServiceError';
  }
}

// src/config/index.ts
import { createClerkClient } from '@clerk/backend';
import Stripe from 'stripe';
import { DynamoDB } from 'aws-sdk';
import { PriceConfig, BillingInterval } from '../types/billing';

// Initialize services with proper type checking
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error('CLERK_SECRET_KEY is required');
}

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is required');
}

export const clerk = createClerkClient({ 
  secretKey: process.env.CLERK_SECRET_KEY 
});

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  typescript: true,
});

export const dynamodb = new DynamoDB.DocumentClient({
  region: process.env.AWS_REGION,
  maxRetries: 3,
});

// Application constants
export const ORGANIZATIONS_TABLE = process.env.ORGANIZATIONS_TABLE!;
export const FREE_TIER_USER_LIMIT = 2;
export const TRIAL_DAYS = 14;

// Price configuration for different billing intervals
export const PRICE_CONFIG: Record<BillingInterval, PriceConfig> = {
  month: {
    id: process.env.STRIPE_PRICE_ID_MONTHLY!,
    interval: 'month',
    unitAmount: 14,
    name: 'Pro Monthly',
    features: [
      'Unlimited organizations',
      'Add unlimited team members',
      'Priority support',
      'Advanced security features'
    ]
  },
  year: {
    id: process.env.STRIPE_PRICE_ID_YEARLY!,
    interval: 'year',
    unitAmount: 120,
    name: 'Pro Yearly',
    features: [
      'All Monthly features',
      '28% yearly discount',
      'Annual invoicing',
      'Dedicated support'
    ]
  }
};

// src/lib/db.ts
/**
 * Database operations for organizations
 * Includes error handling and type safety
 */
import { DynamoDB } from 'aws-sdk';
import { Organization } from '../types/billing';
import { dynamodb, ORGANIZATIONS_TABLE } from '../config';
import { BillingServiceError } from './errors';

export async function getOrganization(organizationId: string): Promise<Organization | null> {
  try {
    const result = await dynamodb.get({
      TableName: ORGANIZATIONS_TABLE,
      Key: { id: organizationId },
      ConsistentRead: true // Ensure we get the latest data
    }).promise();

    return result.Item as Organization || null;
  } catch (error) {
    throw new BillingServiceError(
      'Failed to fetch organization',
      'database_error',
      500,
      error as Error
    );
  }
}

export async function getOrganizationByClerkId(clerkOrgId: string): Promise<Organization | null> {
  try {
    const result = await dynamodb.query({
      TableName: ORGANIZATIONS_TABLE,
      IndexName: 'ClerkOrgIdIndex',
      KeyConditionExpression: 'clerkOrgId = :clerkOrgId',
      ExpressionAttributeValues: { ':clerkOrgId': clerkOrgId }
    }).promise();

    return result.Items?.[0] as Organization || null;
  } catch (error) {
    throw new BillingServiceError(
      'Failed to fetch organization by Clerk ID',
      'database_error',
      500,
      error as Error
    );
  }
}

export async function updateOrganization(
  organizationId: string,
  updates: Partial<Organization>
): Promise<Organization> {
  try {
    const updateExpression = 'set updatedAt = :updatedAt, ' + 
      Object.keys(updates)
        .map((key) => `#${key} = :${key}`)
        .join(', ');

    const result = await dynamodb.update({
      TableName: ORGANIZATIONS_TABLE,
      Key: { id: organizationId },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: Object.keys(updates).reduce(
        (acc, key) => ({ ...acc, [`#${key}`]: key }), {}
      ),
      ExpressionAttributeValues: {
        ...Object.entries(updates).reduce(
          (acc, [key, value]) => ({ ...acc, [`:${key}`]: value }), {}
        ),
        ':updatedAt': Date.now()
      },
      ReturnValues: 'ALL_NEW'
    }).promise();

    return result.Attributes as Organization;
  } catch (error) {
    throw new BillingServiceError(
      'Failed to update organization',
      'database_error',
      500,
      error as Error
    );
  }
}

// src/services/clerk-service.ts
/**
 * Clerk integration service
 * Handles user permissions and organization limits
 */
import { clerk } from '../config';
import { BillingInterval } from '../types/billing';
import { BillingServiceError } from '../lib/errors';

export async function updateClerkUserAccess(
  userId: string,
  subscriptionStatus: string,
  billingInterval?: BillingInterval
): Promise<void> {
  try {
    await clerk.users.updateUser(userId, {
      createOrganizationEnabled: true,
      // All users can create unlimited organizations
      createOrganizationsLimit: null,
      privateMetadata: {
        subscriptionStatus,
        billingInterval,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    throw new BillingServiceError(
      'Failed to update user permissions',
      'clerk_error',
      500,
      error as Error
    );
  }
}

export async function updateClerkOrgLimits(
  clerkOrgId: string,
  memberLimit: number,
  subscriptionData?: {
    subscriptionId: string;
    subscriptionStatus: string;
    billingInterval: BillingInterval;
  }
): Promise<void> {
  try {
    await clerk.organizations.updateOrganization(clerkOrgId, {
      maxAllowedMemberships: memberLimit,
      privateMetadata: {
        maxMembers: memberLimit,
        updatedAt: new Date().toISOString(),
        ...(subscriptionData && {
          subscriptionId: subscriptionData.subscriptionId,
          subscriptionStatus: subscriptionData.subscriptionStatus,
          billingInterval: subscriptionData.billingInterval
        })
      }
    });
  } catch (error) {
    throw new BillingServiceError(
      'Failed to update organization limits',
      'clerk_error',
      500,
      error as Error
    );
  }
}

// src/services/stripe-service.ts
/**
 * Stripe integration service
 * Handles all payment and subscription operations
 */
import { stripe, PRICE_CONFIG, FREE_TIER_USER_LIMIT, TRIAL_DAYS } from '../config';
import { CheckoutSessionParams, SubscriptionUpdateParams } from '../types/billing';
import { getOrganization, updateOrganization } from '../lib/db';
import { updateClerkOrgLimits } from './clerk-service';
import { BillingServiceError } from '../lib/errors';

export async function createCheckoutSession({
  organizationId,
  billingInterval,
  successUrl,
  cancelUrl
}: CheckoutSessionParams) {
  const organization = await getOrganization(organizationId);
  if (!organization) {
    throw new BillingServiceError(
      'Organization not found',
      'not_found',
      404
    );
  }

  try {
    // Create or get Stripe customer
    let stripeCustomerId = organization.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: organization.billingEmail || organization.email,
        name: organization.name,
        metadata: { 
          organizationId,
          clerkOrgId: organization.clerkOrgId
        },
      });
      stripeCustomerId = customer.id;
      await updateOrganization(organizationId, { stripeCustomerId });
    }

    // Calculate paid seats (excluding free tier)
    const paidSeats = Math.max(0, organization.activeSeats - FREE_TIER_USER_LIMIT);

    return stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{
        price: PRICE_CONFIG[billingInterval].id,
        quantity: paidSeats,
      }],
      subscription_data: {
        metadata: { 
          organizationId,
          clerkOrgId: organization.clerkOrgId,
          billingInterval 
        },
        trial_period_days: TRIAL_DAYS,
      },
      metadata: { 
        organizationId,
        clerkOrgId: organization.clerkOrgId,
        billingInterval 
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  } catch (error) {
    throw new BillingServiceError(
      'Failed to create checkout session',
      'stripe_error',
      500,
      error as Error
    );
  }
}

/**
 * Updates subscription seats and billing interval
 */
export async function updateSubscription({
  organizationId,
  newSeatCount,
  billingInterval
}: SubscriptionUpdateParams) {
  const organization = await getOrganization(organizationId);
  if (!organization) {
    throw new BillingServiceError('Organization not found', 'not_found', 404);
  }

  try {
    const paidSeats = Math.max(0, newSeatCount - FREE_TIER_USER_LIMIT);

    if (organization.stripeSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(
        organization.stripeSubscriptionId
      );

      const updateParams: Stripe.SubscriptionUpdateParams = {
        items: [{
          id: subscription.items.data[0].id,
          quantity: paidSeats,
        }],
      };

      // Update billing interval if specified
      if (billingInterval && billingInterval !== organization.billingInterval) {
        updateParams.items![0].price = PRICE_CONFIG[billingInterval].id;
        updateParams.proration_behavior = 'create_prorations';
      }

      const updated = await stripe.subscriptions.update(
        organization.stripeSubscriptionId,
        updateParams
      );

      // Sync updates with Clerk and database
      await Promise.all([
        updateOrganization(organizationId, {
          activeSeats: newSeatCount,
          totalSeats: Math.max(organization.totalSeats, newSeatCount),
          maxMembers: newSeatCount,
          billingInterval: billingInterval || organization.billingInterval,
        }),
        updateClerkOrgLimits(organization.clerkOrgId, newSeatCount, {
          subscriptionId: updated.id,
          subscriptionStatus: updated.status,
          billingInterval: billingInterval || organization.billingInterval as BillingInterval,
        })
      ]);

      return updated;
    }

    return null;
  } catch (error) {
    throw new BillingServiceError(
      'Failed to update subscription',
      'stripe_error',
      500,
      error as Error
    );
  }
}

export async function cancelSubscription(organizationId: string) {
  const organization = await getOrganization(organizationId);
  if (!organization?.stripeSubscriptionId) {
    throw new BillingServiceError('No active subscription', 'not_found', 404);
  }

  try {
    const subscription = await stripe.subscriptions.update(
      organization.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    await updateOrganization(organizationId, {
      billingStatus: 'canceled',
    });

    return subscription;
  } catch (error) {
    throw new BillingServiceError(
      'Failed to cancel subscription',
      'stripe_error',
      500,
      error as Error
    );
  }
}