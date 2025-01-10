import { Logger } from '@aws-lambda-powertools/logger';
import { EventBridgeEvent } from 'aws-lambda';
import { Metadata, BillingStatus, BillingInterval } from './types';
import Stripe from 'stripe';
import { initClerk, updateOrganizationMaxMembers } from "./lib/clerk";
import { getSubscription, updateSubscriptionBillingInfo } from './lib/subscriptions';
import { getOrganizationById } from './lib/organizations';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import { IdempotencyConfig } from '@aws-lambda-powertools/idempotency';
import { DynamoDBPersistenceLayer } from '@aws-lambda-powertools/idempotency/dynamodb';
import { makeHandlerIdempotent } from '@aws-lambda-powertools/idempotency/middleware';
import { idempotencyTableName } from './lib/dynamodb-helper';

type EventEnvelope = {
  metadata: Metadata;
  data: Stripe.Subscription;
}
type Event = EventBridgeEvent<'customer.subscription.updated', EventEnvelope>;

const logger = new Logger();

const _handler = async (event: Event, context: any): Promise<void> => {
  initClerk(context.CLERK_SECRET_KEY);

  const { data } = event.detail;
  const subscriptionStatus = 'active' as BillingStatus;
  const billingInterval = data.items.data[0].plan.interval as BillingInterval;

  const subId = data.id;
  const subscription = await getSubscription(subId);

  if (!subscription) {
    throw new Error(`Subscription id not found: [${subId}].`);
  }

  if (subscription.type == 'organization') {
    logger.info('Updating organization max members');

    const org = await getOrganizationById(subscription.orgId!);
    if (!org) {
      throw new Error(`Organization id not found: [${subscription.orgId}].`);
    }

    const maxMembers = data.items.data[0].quantity!;
    await updateOrganizationMaxMembers(org.clerkOrgId, maxMembers);
  }

  logger.info('Updating subscription');
  await updateSubscriptionBillingInfo(subId, subscriptionStatus, billingInterval);  
};

const { SSM_STAGE_NAME } = process.env;

const persistenceStore = new DynamoDBPersistenceLayer({
  tableName: idempotencyTableName(),
});

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      CLERK_SECRET_KEY: `/evolua/${SSM_STAGE_NAME}/clerk/secret-key`,
    }
  }))
  .use(makeHandlerIdempotent({
    persistenceStore, 
    config: new IdempotencyConfig({
      eventKeyJmesPath: 'detail.metadata.idempotencyKey',
      throwOnNoIdempotencyKey: true,
    })
  }));
