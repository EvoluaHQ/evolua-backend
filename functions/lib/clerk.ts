import { Logger } from '@aws-lambda-powertools/logger';
import { createClerkClient, ClerkClient } from '@clerk/backend';
import { BillingStatus, BillingInterval } from '../types/billing';

let clerkClient: ClerkClient

const logger = new Logger();

export const initClerk = (secretKey: string) => {
  clerkClient = createClerkClient({
    secretKey
  })
}

export type UserMetadata = {
  githubAccessToken?: string
  githubRefreshToken?: string
  githubTokenExpiresAt?: number
}

interface OrgMetadata {
  maxMembers: number;
  subscriptionId: string;
  subscriptionStatus: BillingStatus;
  billingInterval: BillingInterval;
  lastUpdatedAt: string;
}

export const getUserMetadata = async (clerkUserId: string): Promise<UserMetadata> => {
  const clerkUser = await clerkClient.users.getUser(clerkUserId)
  return clerkUser.privateMetadata as UserMetadata
}

export async function disableOrgCreation(userId: string): Promise<void> {
  await clerkClient.users.updateUser(userId, {
    createOrganizationEnabled: false,
    createOrganizationsLimit: 0,
  });
}

export async function incrOrgCreationCount(userId: string): Promise<void> {
  const clerkUser = await clerkClient.users.getUser(userId);

  await clerkClient.users.updateUser(userId, {
    createOrganizationEnabled: true,
    createOrganizationsLimit: (clerkUser.createOrganizationsLimit || 0) + 1,
  });
}

export async function createOrganization(
  userId: string,
  name: string,
  metadata: OrgMetadata
): Promise<string> {
  // generate 8 random characters
  const random = Math.random().toString(36).substring(2, 10);
  // slugs are unique, so if you try to create an organization with the same slug
  // as another, then it won't create a new organization
  const slug = name.toLowerCase() + `-${random}`;
  const organization = await clerkClient.organizations.createOrganization({
    name,
    createdBy: userId,
    slug,
    maxAllowedMemberships: metadata.maxMembers,
    privateMetadata: metadata as any,
  });

  return organization.id;
}

export async function getOrganizationById(organizationId: string) {
  return clerkClient.organizations.getOrganization({ organizationId });
}

export async function updateOrganizationMaxMembers(
  organizationId: string,
  maxMembers: number
) {
  const org = await clerkClient.organizations.getOrganization({
    organizationId,
  });

  if (!org) {
    throw new Error(`Organization not found: ${organizationId}`);
  }

  const membersCount = org.membersCount || 0;
  if (membersCount > maxMembers) {
    logger.warn('Organization has too many members', {
      organizationId,
      membersCount,
      newMaxMembers: maxMembers,
    })

    logger.info('Removing members from organization (newest members first)', {
      count: membersCount - maxMembers,
    });

    // most recent members first, so we can remove the newest members first
    // don't want to remove oldest members first, because the admin is the oldest member
    const membersList = await clerkClient.organizations.getOrganizationMembershipList({
      organizationId,
      orderBy: '-created_at'
    });

    const membersToRemove = membersList.data.slice(0, membersCount - maxMembers);
    for (const member of membersToRemove) {
      await clerkClient.organizations.deleteOrganizationMembership({
        organizationId,
        userId: member.publicUserData!.userId
      });
    }
  }

  await clerkClient.organizations.updateOrganization(organizationId, {
    maxAllowedMemberships: maxMembers,
    privateMetadata: {
      ...org.privateMetadata,
      maxMembers,
      lastUpdatedAt: new Date().toISOString(),
    },
  });
}

export async function updateOrganizationMetadata(
  organizationId: string,
  metadata: OrgMetadata
) {
  await clerkClient.organizations.updateOrganization(organizationId, {
    privateMetadata: metadata as any,
  });
}
