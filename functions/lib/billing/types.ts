// src/types/billing.ts

import { ClerkAPIError } from "@clerk/backend";
import { Stripe } from "stripe";

/**
 * Billing interval options for subscriptions
 * - month: Monthly billing cycle
 * - year: Annual billing cycle (includes discount)
 */
export type BillingInterval = "month" | "year";

/**
 * Possible states of an organization's billing status
 * - free: Using free tier (up to 2 members)
 * - trialing: In trial period of Pro plan
 * - active: Paid subscription is active
 * - past_due: Payment failed but grace period active
 * - canceled: Subscription has been canceled
 * - incomplete: Payment requires attention
 */
export type BillingStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

/**
 * Configuration for a price tier in Stripe
 */
export interface PriceConfig {
  /** Stripe price ID */
  id: string;

  /** Billing interval for this price */
  interval: BillingInterval;

  /** Amount per seat in cents */
  unitAmount: number;

  /** Display name for this price tier */
  name: string;
}

/**
 * Core organization data structure
 * Combines Clerk organization data with Stripe billing information
 */
export interface Organization {
  /** Unique organization ID */
  id: string;

  /** Organization name */
  name: string;

  /** Primary email */
  email: string;

  /** Clerk organization ID */
  clerkOrgId: string;

  /** Stripe customer ID if available */
  stripeCustomerId?: string;

  /** Stripe subscription ID if subscribed */
  stripeSubscriptionId?: string;

  /** Current billing status */
  billingStatus: BillingStatus;

  /** Timestamp when current billing period ends */
  currentPeriodEnd?: number;

  /** Current Stripe price ID */
  priceId?: string;

  /** Current billing interval */
  billingInterval?: BillingInterval;

  /** Total seats allocated */
  totalSeats: number;

  /** Currently used seats */
  activeSeats: number;

  /** Maximum allowed members */
  maxMembers: number;

  /** Billing contact email */
  billingEmail?: string;

  /** Default payment method ID */
  paymentMethodId?: string;

  /** Trial period end timestamp */
  trialEndsAt?: number;

  /** Record creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Parameters for updating a subscription
 */
export interface SubscriptionUpdateParams {
  /** Organization to update */
  organizationId: string;

  /** New number of seats */
  newSeatCount: number;

  /** Optional new billing interval */
  billingInterval?: BillingInterval;
}

/**
 * Parameters for creating a checkout session
 */
export interface CheckoutSessionParams {
  /** Organization starting checkout */
  organizationId: string;

  /** Selected billing interval */
  billingInterval: BillingInterval;

  /** URL to redirect after successful checkout */
  successUrl: string;

  /** URL to redirect after canceled checkout */
  cancelUrl: string;
}

/**
 * Extended error type for billing operations
 * Includes original errors from Stripe or Clerk
 */
export interface BillingServiceError extends Error {
  /** Error code for identifying error type */
  code: string;

  /** HTTP status code */
  statusCode: number;

  /** Original error from external service */
  originalError?: Error | Stripe.StripeError | ClerkAPIError;
}

/**
 * Webhook event payload from Stripe
 */
export interface WebhookEvent {
  /** Event type */
  type: string;

  /** Event data */
  data: {
    object: any;
  };

  /** Event creation timestamp */
  created: number;
}

/**
 * Response from subscription operations
 */
export interface SubscriptionResponse {
  /** Client secret for handling payment if needed */
  clientSecret?: string;

  /** Stripe subscription ID */
  subscriptionId: string;

  /** Current subscription status */
  status: BillingStatus;

  /** Timestamp for current period end */
  currentPeriodEnd: number;
}
