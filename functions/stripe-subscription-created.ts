import { Logger } from '@aws-lambda-powertools/logger';
import { EventBridgeEvent } from 'aws-lambda';
import { Metadata, BillingStatus, BillingInterval } from './types';
import Stripe from 'stripe';
import { initClerk, incrOrgCreationCount, createOrganization } from "./lib/clerk";
import { findUserByClerkUserId, upsertUser } from './lib/users';
import { addOrganization, Organization, OrganizationMember } from './lib/organizations';
import { createSubscription } from './lib/subscriptions';
import { ulid } from 'ulid';
import middy from '@middy/core';
import ssm from '@middy/ssm';

const { SSM_STAGE_NAME } = process.env;

type EventEnvelope = {
  metadata: Metadata;
  data: Stripe.Subscription;
}
type Event = EventBridgeEvent<'customer.subscription.created', EventEnvelope>;

const logger = new Logger();

const _handler = async (event: Event, context: any): Promise<void> => {
  const now = new Date().toISOString();

  initClerk(context.CLERK_SECRET_KEY);

  const { data, metadata } = event.detail;
  const subscriptionStatus = 'active' as BillingStatus;
  const billingInterval = data.items.data[0].plan.interval as BillingInterval;
  const { type, clerkUserId, organizationId, organizationName } = data.metadata;

  if (!clerkUserId) {
    throw new Error('Missing "clerkUserId" in stripe metadata');
  }

  const user = await findUserByClerkUserId(clerkUserId);
  if (!user) {
    logger.error(`User not found by Clerk user ID: [${clerkUserId}]`, {
      stripeMetadata: data.metadata,
      eventMetadata: metadata,
      stripeMetadataType: type,
      clerkUserId,
      organizationId
    });

    throw new Error(`User not found by Clerk user ID: [${clerkUserId}]`);
  }

  if (type === 'UpgradeProfile') {
    logger.info('Upgrading user profile to PRO');

    user.tier = 'PRO';
    user.lastUpdatedAt = now;

    await upsertUser(user);

    logger.info('Creating new subscription');

    await createSubscription({
      subId: data.id,
      type: 'organization',
      userId: user.id,
      status: subscriptionStatus,
      billingInterval,
      createdAt: now,
      lastUpdatedAt: now,
    });
  } else if (type === 'CreateOrganization') {
    if (!organizationName) {
      throw new Error('Missing "organizationName" in stripe metadata');
    }

    logger.info('Incrementing organization creation count by 1');

    await incrOrgCreationCount(clerkUserId);    

    logger.info('Creating new organization');

    const maxMembers = data.items.data[0].quantity || 1;
    const orgMetadata = {
      subscriptionId: data.id,
      subscriptionStatus,
      billingInterval,
      maxMembers,
      lastUpdatedAt: now,
    };
    const clerkOrgId = await createOrganization(clerkUserId, organizationName, orgMetadata);

    const orgId = ulid();
    const organization: Organization = {
      orgId,
      clerkOrgId,
      name: organizationName,
      createdAt: now,
      lastUpdatedAt: now,
      maxMembers,
      deleted: false,
    };
    const adminMember: OrganizationMember = {
      orgId,
      clerkOrgId,
      clerkUserId,
      role: "admin",
      createdAt: now,
    };

    await addOrganization(organization, adminMember);

    logger.info('Creating new subscription');
    
    await createSubscription({
      subId: data.id,
      type: 'organization',
      orgId,
      status: subscriptionStatus,
      billingInterval,
      createdAt: now,
      lastUpdatedAt: now,
    });
  } else {
    logger.error(`Unsupported stripe metadata "type": [${type}]`, {
      stripeMetadata: data.metadata,
      eventMetadata: metadata,
      stripeMetadataType: type,
      clerkUserId,
      organizationId
    });

    throw new Error(`Unsupported stripe metadata "type": [${type}]`);
  }
};

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      CLERK_SECRET_KEY: `/evolua/${SSM_STAGE_NAME}/clerk/secret-key`,
    }
  }));
