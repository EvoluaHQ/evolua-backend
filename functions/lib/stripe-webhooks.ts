// src/handlers/stripe-webhook.ts
import { APIGatewayProxyEvent } from "aws-lambda";
import Stripe from "stripe";
import { clerk, stripe } from "../config";
import { getOrganizationByClerkId, updateOrganization } from "../lib/db";
import { BillingServiceError } from "../lib/errors";
import {
  updateClerkOrgLimits,
  updateClerkUserAccess,
} from "../services/clerk-service";
import { BillingInterval } from "../types/billing";

const relevantEvents = new Set([
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted",
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

/**
 * Manages subscription changes triggered by Stripe events
 */
async function manageSubscriptionChange(
  subscription: Stripe.Subscription,
  isNewSubscription: boolean
) {
  const { organizationId, clerkOrgId } = subscription.metadata;

  if (!organizationId || !clerkOrgId) {
    throw new BillingServiceError(
      "Missing organization metadata",
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
    console.error("Failed to manage subscription change:", error);
    throw error;
  }
}

/**
 * Handles updates to Stripe Product records
 */
async function upsertProductRecord(product: Stripe.Product) {
  // Store product data in DynamoDB if needed
  // Implementation depends on your product management needs
}

/**
 * Handles updates to Stripe Price records
 */
async function upsertPriceRecord(price: Stripe.Price) {
  // Store price data in DynamoDB if needed
  // Implementation depends on your price management needs
}

/**
 * AWS Lambda handler for Stripe webhooks
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

    // Parse and verify the webhook event
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
      switch (stripeEvent.type) {
        case "product.created":
        case "product.updated":
          await upsertProductRecord(stripeEvent.data.object as Stripe.Product);
          break;

        case "price.created":
        case "price.updated":
          await upsertPriceRecord(stripeEvent.data.object as Stripe.Price);
          break;

        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          const subscription = stripeEvent.data.object as Stripe.Subscription;
          await manageSubscriptionChange(
            subscription,
            stripeEvent.type === "customer.subscription.created"
          );
          break;

        case "checkout.session.completed":
          const session = stripeEvent.data.object as Stripe.Checkout.Session;
          if (session.mode === "subscription" && session.subscription) {
            const subscription = await stripe.subscriptions.retrieve(
              session.subscription as string
            );
            await manageSubscriptionChange(subscription, true);
          }
          break;

        case "invoice.paid":
        case "invoice.payment_failed":
          const invoice = stripeEvent.data.object as Stripe.Invoice;
          const { organizationId } = invoice.metadata;

          if (!organizationId) {
            throw new Error("Missing organizationId in invoice metadata");
          }

          await updateOrganization(organizationId, {
            billingStatus:
              stripeEvent.type === "invoice.paid" ? "active" : "past_due",
          });
          break;

        default:
          throw new Error("Unhandled relevant event!");
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
