// src/lib/errors.ts

import { ClerkAPIError } from "@clerk/backend";
import { Stripe } from "stripe";

/**
 * Error codes used throughout the billing service
 */
export type BillingErrorCode =
  // General errors
  | "unknown_error"
  | "validation_error"
  | "invalid_metadata"
  | "configuration_error"

  // Database errors
  | "database_error"
  | "record_not_found"

  // Stripe errors
  | "stripe_error"
  | "stripe_webhook_error"
  | "invalid_payment"

  // Clerk errors
  | "clerk_error"
  | "unauthorized"

  // Subscription errors
  | "invalid_subscription"
  | "subscription_not_found";

/**
 * Custom error class for billing service operations
 */
export class BillingServiceError extends Error {
  constructor(
    message: string,
    public readonly code: BillingErrorCode,
    public readonly statusCode: number = 400,
    public readonly originalError?: Error | Stripe.StripeError | ClerkAPIError
  ) {
    super(message);
    this.name = "BillingServiceError";

    // Maintains proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BillingServiceError);
    }
  }

  /**
   * Creates an API response object
   */
  toResponse() {
    return {
      error: {
        message: this.message,
        code: this.code,
      },
      statusCode: this.statusCode,
    };
  }
}

/**
 * Helper functions for creating common errors
 */
export const BillingErrors = {
  /**
   * Database operation errors
   */
  notFound: (resource: string) =>
    new BillingServiceError(`${resource} not found`, "record_not_found", 404),

  databaseError: (message: string, originalError?: Error) =>
    new BillingServiceError(message, "database_error", 500, originalError),

  /**
   * Stripe-related errors
   */
  stripeError: (message: string, originalError?: Stripe.StripeError) =>
    new BillingServiceError(
      message,
      "stripe_error",
      originalError?.statusCode || 500,
      originalError
    ),

  webhookError: (message: string, originalError?: Error) =>
    new BillingServiceError(
      message,
      "stripe_webhook_error",
      400,
      originalError
    ),

  invalidMetadata: (message: string) =>
    new BillingServiceError(message, "invalid_metadata", 400),

  /**
   * Clerk-related errors
   */
  clerkError: (message: string, originalError?: ClerkAPIError) =>
    new BillingServiceError(
      message,
      "clerk_error",
      originalError?.status || 500,
      originalError
    ),

  unauthorized: () =>
    new BillingServiceError("Unauthorized access", "unauthorized", 401),

  /**
   * Subscription-related errors
   */
  subscriptionNotFound: () =>
    new BillingServiceError(
      "Subscription not found",
      "subscription_not_found",
      404
    ),

  invalidSubscription: (message: string) =>
    new BillingServiceError(message, "invalid_subscription", 400),

  /**
   * Configuration errors
   */
  configuration: (message: string) =>
    new BillingServiceError(message, "configuration_error", 500),
};

/**
 * Type guard to check if an error is a BillingServiceError
 */
export function isBillingServiceError(
  error: unknown
): error is BillingServiceError {
  return error instanceof BillingServiceError;
}

/**
 * Handles unknown errors by converting them to BillingServiceError
 */
export function handleUnknownError(error: unknown): BillingServiceError {
  if (error instanceof Stripe.StripeError) {
    return BillingErrors.stripeError(error.message, error);
  }

  if ((error as ClerkAPIError).status !== undefined) {
    return BillingErrors.clerkError(error.message, error as ClerkAPIError);
  }

  if (error instanceof Error) {
    return new BillingServiceError(error.message, "unknown_error", 500, error);
  }

  return new BillingServiceError(
    "An unknown error occurred",
    "unknown_error",
    500
  );
}
