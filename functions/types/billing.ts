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
