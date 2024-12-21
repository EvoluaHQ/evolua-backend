import { EventBridgeEvent } from "aws-lambda";
import { EventEnvelope, ClerkUserUpsertedEventDetail } from "./types";
import { initClerk, disableOrgCreation } from "./lib/clerk";
import middy from '@middy/core';
import ssm from '@middy/ssm';

const { SSM_STAGE_NAME } = process.env;

type Event = EventBridgeEvent<"user.created", EventEnvelope<ClerkUserUpsertedEventDetail>>;

const _handler = async (event: Event, context: any) => {
  const clerkUserId = event.detail.data.data.id;

  initClerk(context.CLERK_SECRET_KEY);

  await disableOrgCreation(clerkUserId);
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
