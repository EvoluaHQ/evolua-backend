// src/services/stripe-service.ts

import Stripe from "stripe";
import { updateClerkOrgLimits } from "./clerk-service";
import { stripe } from "./config";
import { getOrganization, updateOrganization } from "./db";
import { BillingServiceError } from "./errors";
import { BillingInterval, Organization } from "./types";

// Constants
const FREE_TIER_USER_LIMIT = 2;
const TRIAL_DAYS = 14;

interface PriceConfig {
  id: string;
  interval: BillingInterval;
  unitAmount: number;
  name: string;
  features: string[];
}

// Price configuration
const PRICE_CONFIG: Record<BillingInterval, PriceConfig> = {
  month: {
    id: process.env.STRIPE_PRICE_ID_MONTHLY!,
    interval: "month",
    unitAmount: 14,
    name: "Pro Monthly",
    features: [
      "Unlimited organizations",
      "Add unlimited team members",
      "Priority support",
      "Advanced features",
    ],
  },
  year: {
    id: process.env.STRIPE_PRICE_ID_YEARLY!,
    interval: "year",
    unitAmount: 120,
    name: "Pro Yearly",
    features: [
      "All Monthly features",
      "28% yearly discount",
      "Annual invoicing",
    ],
  },
};

interface CreateCheckoutSessionParams {
  organizationId: string;
  billingInterval: BillingInterval;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Creates an embedded checkout session for subscription creation
 */
export async function createEmbeddedCheckoutSession({
  organizationId,
  billingInterval,
  successUrl,
  cancelUrl,
}: CreateCheckoutSessionParams) {
  const organization = await getOrganization(organizationId);
  if (!organization) {
    throw new BillingServiceError("Organization not found", "not_found", 404);
  }

  try {
    // Get or create Stripe customer
    let stripeCustomerId = organization.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: organization.email,
        name: organization.name,
        metadata: {
          organizationId,
          clerkOrgId: organization.clerkOrgId,
        },
      });
      stripeCustomerId = customer.id;

      // Update organization with new customer ID
      await updateOrganization(organizationId, { stripeCustomerId });
    }

    // Calculate paid seats (excluding free tier)
    const paidSeats = Math.max(
      0,
      organization.activeSeats - FREE_TIER_USER_LIMIT
    );

    // Create embedded checkout session
    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [
        {
          price: PRICE_CONFIG[billingInterval].id,
          quantity: paidSeats,
        },
      ],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: {
          organizationId,
          clerkOrgId: organization.clerkOrgId,
          billingInterval,
        },
      },
      return_url: successUrl,
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      customer_update: {
        address: "auto",
        name: "auto",
      },
      billing_address_collection: "required",
      payment_method_collection: "always",
      metadata: {
        organizationId,
        clerkOrgId: organization.clerkOrgId,
        billingInterval,
      },
    });

    return { clientSecret: session.client_secret };
  } catch (error) {
    console.error("Failed to create checkout session:", error);
    throw new BillingServiceError(
      "Failed to create checkout session",
      "stripe_error",
      500,
      error as Error
    );
  }
}

/**
 * Retrieves checkout session status
 */
export async function getCheckoutSessionStatus(sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"],
    });

    return {
      status: session.status,
      customerEmail: session.customer_details?.email,
      subscription: session.subscription,
    };
  } catch (error) {
    throw new BillingServiceError(
      "Failed to retrieve session status",
      "stripe_error",
      500,
      error as Error
    );
  }
}

/**
 * Updates subscription seats count
 */
export async function updateSubscriptionSeats(
  organizationId: string,
  newSeatCount: number
) {
  const organization = await getOrganization(organizationId);
  if (!organization?.stripeSubscriptionId) {
    throw new BillingServiceError("No active subscription", "not_found", 404);
  }

  try {
    const paidSeats = Math.max(0, newSeatCount - FREE_TIER_USER_LIMIT);

    const subscription = await stripe.subscriptions.update(
      organization.stripeSubscriptionId,
      {
        items: [
          {
            id: organization.stripeSubscriptionId,
            quantity: paidSeats,
          },
        ],
        metadata: {
          organizationId,
          clerkOrgId: organization.clerkOrgId,
        },
      }
    );

    // Update organization and Clerk limits
    await Promise.all([
      updateOrganization(organizationId, {
        activeSeats: newSeatCount,
        totalSeats: Math.max(organization.totalSeats, newSeatCount),
      }),
      updateClerkOrgLimits(organization.clerkOrgId, newSeatCount),
    ]);

    return subscription;
  } catch (error) {
    throw new BillingServiceError(
      "Failed to update subscription seats",
      "stripe_error",
      500,
      error as Error
    );
  }
}

/**
 * Creates customer portal session for subscription management
 */
export async function createCustomerPortalSession(
  organizationId: string,
  returnUrl: string
) {
  const organization = await getOrganization(organizationId);
  if (!organization?.stripeCustomerId) {
    throw new BillingServiceError("No customer found", "not_found", 404);
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: organization.stripeCustomerId,
      return_url: returnUrl,
      flow_data: {
        type: "subscription_cancel",
        subscription_cancel: {
          mode: "at_period_end",
        },
      },
    });

    return { url: portalSession.url };
  } catch (error) {
    throw new BillingServiceError(
      "Failed to create portal session",
      "stripe_error",
      500,
      error as Error
    );
  }
}

/**
 * Cancels an active subscription
 */
export async function cancelSubscription(organizationId: string) {
  const organization = await getOrganization(organizationId);
  if (!organization?.stripeSubscriptionId) {
    throw new BillingServiceError("No active subscription", "not_found", 404);
  }

  try {
    const subscription = await stripe.subscriptions.update(
      organization.stripeSubscriptionId,
      { cancel_at_period_end: true }
    );

    await updateOrganization(organizationId, {
      billingStatus: "canceled",
    });

    return subscription;
  } catch (error) {
    throw new BillingServiceError(
      "Failed to cancel subscription",
      "stripe_error",
      500,
      error as Error
    );
  }
}
