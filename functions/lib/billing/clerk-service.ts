// src/services/clerk-service.ts

import { createClerkClient } from "@clerk/backend";
import { BillingServiceError } from "./errors";
import { BillingInterval, BillingStatus } from "./types";

/**
 * Initialize Clerk client with proper error handling
 */
if (!process.env.CLERK_SECRET_KEY) {
  throw new Error("CLERK_SECRET_KEY is not defined");
}

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

/**
 * Types for Clerk service operations
 */
interface ClerkUserAccess {
  userId: string;
  subscriptionStatus: BillingStatus;
  billingInterval?: BillingInterval;
}

interface ClerkOrgLimits {
  clerkOrgId: string;
  memberLimit: number;
  subscriptionData?: {
    subscriptionId: string;
    subscriptionStatus: BillingStatus;
    billingInterval: BillingInterval;
  };
}

interface ClerkOrgMetadata {
  maxMembers: number;
  subscriptionId?: string;
  subscriptionStatus?: BillingStatus;
  billingInterval?: BillingInterval;
  updatedAt: string;
}

/**
 * Updates a user's organization permissions in Clerk
 * All users can create unlimited organizations
 * @throws {BillingServiceError}
 */
export async function updateClerkUserAccess({
  userId,
  subscriptionStatus,
  billingInterval,
}: ClerkUserAccess): Promise<void> {
  try {
    const privateMetadata = {
      subscriptionStatus,
      billingInterval,
      updatedAt: new Date().toISOString(),
    };

    await clerk.users.updateUser(userId, {
      privateMetadata,
      // Allow unlimited organization creation for all users
      createOrganizationEnabled: true,
      createOrganizationsLimit: null,
    });
  } catch (error) {
    console.error("Failed to update Clerk user access:", error);
    throw new BillingServiceError(
      "Failed to update user permissions",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Updates an organization's member limits in Clerk
 * @throws {BillingServiceError}
 */
export async function updateClerkOrgLimits({
  clerkOrgId,
  memberLimit,
  subscriptionData,
}: ClerkOrgLimits): Promise<void> {
  try {
    const metadata: ClerkOrgMetadata = {
      maxMembers: memberLimit,
      updatedAt: new Date().toISOString(),
      ...(subscriptionData && {
        subscriptionId: subscriptionData.subscriptionId,
        subscriptionStatus: subscriptionData.subscriptionStatus,
        billingInterval: subscriptionData.billingInterval,
      }),
    };

    await clerk.organizations.updateOrganization(clerkOrgId, {
      maxAllowedMemberships: memberLimit,
      privateMetadata: metadata,
    });
  } catch (error) {
    console.error("Failed to update Clerk organization limits:", error);
    throw new BillingServiceError(
      "Failed to update organization limits",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Gets organization owner's user ID
 * @throws {BillingServiceError}
 */
export async function getOrganizationOwnerId(
  clerkOrgId: string
): Promise<string | null> {
  try {
    const members = await clerk.organizations.getOrganizationMembershipList({
      organizationId: clerkOrgId,
    });

    const owner = members.find((member) => member.role === "admin");
    return owner?.publicUserData.userId || null;
  } catch (error) {
    console.error("Failed to get organization owner:", error);
    throw new BillingServiceError(
      "Failed to get organization owner",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Gets current member count for an organization
 * @throws {BillingServiceError}
 */
export async function getOrganizationMemberCount(
  clerkOrgId: string
): Promise<number> {
  try {
    const members = await clerk.organizations.getOrganizationMembershipList({
      organizationId: clerkOrgId,
    });

    return members.length;
  } catch (error) {
    console.error("Failed to get organization member count:", error);
    throw new BillingServiceError(
      "Failed to get organization member count",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Validates if adding members would exceed limits
 * @throws {BillingServiceError}
 */
export async function validateMemberLimit(
  clerkOrgId: string,
  newMembersCount: number
): Promise<boolean> {
  try {
    const organization = await clerk.organizations.getOrganization({
      organizationId: clerkOrgId,
    });

    const currentMetadata = organization.privateMetadata as ClerkOrgMetadata;
    const currentMembers = await getOrganizationMemberCount(clerkOrgId);

    return currentMembers + newMembersCount <= currentMetadata.maxMembers;
  } catch (error) {
    console.error("Failed to validate member limit:", error);
    throw new BillingServiceError(
      "Failed to validate member limit",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Updates organization metadata without changing limits
 * @throws {BillingServiceError}
 */
export async function updateOrganizationMetadata(
  clerkOrgId: string,
  metadata: Partial<ClerkOrgMetadata>
): Promise<void> {
  try {
    const organization = await clerk.organizations.getOrganization({
      organizationId: clerkOrgId,
    });

    const currentMetadata = organization.privateMetadata as ClerkOrgMetadata;

    await clerk.organizations.updateOrganization(clerkOrgId, {
      privateMetadata: {
        ...currentMetadata,
        ...metadata,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Failed to update organization metadata:", error);
    throw new BillingServiceError(
      "Failed to update organization metadata",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Gets all organizations for a user
 * @throws {BillingServiceError}
 */
export async function getUserOrganizations(userId: string) {
  try {
    const memberships = await clerk.users.getOrganizationMembershipList({
      userId,
    });

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      role: membership.role,
      metadata: membership.organization.privateMetadata as ClerkOrgMetadata,
    }));
  } catch (error) {
    console.error("Failed to get user organizations:", error);
    throw new BillingServiceError(
      "Failed to get user organizations",
      "clerk_error",
      500,
      error as Error
    );
  }
}

/**
 * Checks if user has admin rights in organization
 * @throws {BillingServiceError}
 */
export async function isOrganizationAdmin(
  userId: string,
  clerkOrgId: string
): Promise<boolean> {
  try {
    const membership = await clerk.organizations.getOrganizationMembership({
      organizationId: clerkOrgId,
      userId,
    });

    return membership.role === "admin";
  } catch (error) {
    console.error("Failed to check organization admin status:", error);
    throw new BillingServiceError(
      "Failed to check organization admin status",
      "clerk_error",
      500,
      error as Error
    );
  }
}
