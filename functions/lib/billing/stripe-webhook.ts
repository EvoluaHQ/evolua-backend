// src/handlers/stripe-webhook.ts

import { APIGatewayProxyEvent } from "aws-lambda";
import Stripe from "stripe";
import { updateClerkOrgLimits, updateClerkUserAccess } from "./clerk-service";
import { clerk, stripe } from "./config";
import {
  getOrganization,
  getOrganizationByClerkId,
  updateOrganization,
} from "./db";
import { BillingServiceError } from "./errors";
import { BillingInterval } from "./types";

const FREE_TIER_USER_LIMIT = 2;

/**
 * List of Stripe events we want to handle
 * Includes both subscription and checkout related events
 */
const relevantEvents = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end", // Sent 3 days before trial ends. TODO: How to handle that?
  "invoice.paid",
  "invoice.payment_failed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
]);

/**
 * Handles subscription status changes and updates related systems
 */
async function handleSubscriptionChange(
  subscription: Stripe.Subscription,
  isNewSubscription: boolean = false
) {
  const { organizationId, clerkOrgId } = subscription.metadata;

  if (!organizationId || !clerkOrgId) {
    throw new BillingServiceError(
      "Missing required metadata",
      "invalid_metadata",
      400
    );
  }

  // Get billing interval from subscription
  const billingInterval =
    subscription.items.data[0].price.recurring?.interval === "year"
      ? ("year" as BillingInterval)
      : ("month" as BillingInterval);

  // Calculate total seats (paid + free tier)
  const paidSeats = subscription.items.data[0].quantity;
  const totalSeats = paidSeats + FREE_TIER_USER_LIMIT;

  try {
    // Update organization in DynamoDB
    const updatedOrg = await updateOrganization(organizationId, {
      stripeSubscriptionId: subscription.id,
      billingStatus: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      billingInterval,
      maxMembers: totalSeats,
      totalSeats,
      trialEndsAt: subscription.trial_end || undefined,
    });

    // Update Clerk organization limits
    await updateClerkOrgLimits(clerkOrgId, totalSeats, {
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      billingInterval,
    });

    // For new subscriptions or status changes, update organization owner's permissions
    if (isNewSubscription || subscription.status !== updatedOrg.billingStatus) {
      const orgMembers =
        await clerk.organizations.getOrganizationMembershipList({
          organizationId: clerkOrgId,
        });

      const owner = orgMembers.find((member) => member.role === "admin");
      if (owner) {
        await updateClerkUserAccess(
          owner.publicUserData.userId,
          subscription.status,
          billingInterval
        );
      }
    }
  } catch (error) {
    console.error("Failed to handle subscription change:", error);
    throw error;
  }
}

/**
 * Handles completed checkout sessions
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") {
    return; // Only handle subscription checkouts
  }

  try {
    // Get the subscription details
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription as string,
      {
        expand: ["items.data.price"],
      }
    );

    // Handle the new subscription
    await handleSubscriptionChange(subscription, true);
  } catch (error) {
    console.error("Failed to handle checkout completion:", error);
    throw error;
  }
}

/**
 * Handles invoice payment status changes
 */
async function handleInvoicePayment(
  invoice: Stripe.Invoice,
  wasSuccessful: boolean
) {
  if (!invoice.subscription) return; // Only handle subscription invoices

  const { organizationId } = invoice.metadata;
  if (!organizationId) {
    throw new BillingServiceError(
      "Missing organizationId in invoice metadata",
      "invalid_metadata",
      400
    );
  }

  try {
    // Update organization billing status
    await updateOrganization(organizationId, {
      billingStatus: wasSuccessful ? "active" : "past_due",
    });

    // If payment failed, you might want to notify the user
    if (!wasSuccessful) {
      // Implement notification logic here
      console.log(`Payment failed for organization: ${organizationId}`);
    }
  } catch (error) {
    console.error("Failed to handle invoice payment:", error);
    throw error;
  }
}

/**
 * Main webhook handler for AWS Lambda
 */
export async function handler(event: APIGatewayProxyEvent) {
  try {
    // Verify webhook signature
    const signature = event.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing signature or webhook secret" }),
      };
    }

    // Construct and verify the webhook event
    const stripeEvent = stripe.webhooks.constructEvent(
      event.body!,
      signature,
      webhookSecret
    );

    console.log(`Webhook received: ${stripeEvent.type}`);

    // Handle only relevant events
    if (!relevantEvents.has(stripeEvent.type)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Unsupported event type: ${stripeEvent.type}`,
        }),
      };
    }

    try {
      // Handle different event types
      switch (stripeEvent.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(
            stripeEvent.data.object as Stripe.Checkout.Session
          );
          break;

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          const subscription = stripeEvent.data.object as Stripe.Subscription;
          await handleSubscriptionChange(
            subscription,
            stripeEvent.type === "customer.subscription.created"
          );
          break;

        case "customer.subscription.trial_will_end":
          // Implement trial ending notification logic
          const trialEndingSub = stripeEvent.data.object as Stripe.Subscription;
          console.log(`Trial ending for subscription: ${trialEndingSub.id}`);
          break;

        case "invoice.paid":
        case "invoice.payment_failed":
          const invoice = stripeEvent.data.object as Stripe.Invoice;
          await handleInvoicePayment(
            invoice,
            stripeEvent.type === "invoice.paid"
          );
          break;

        default:
          console.log(`Unhandled relevant event: ${stripeEvent.type}`);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true }),
      };
    } catch (error) {
      console.error("Webhook handler failed:", error);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Webhook handler failed" }),
      };
    }
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Stripe webhook error" }),
    };
  }
}
