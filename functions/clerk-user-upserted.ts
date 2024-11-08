import { EventBridgeEvent } from 'aws-lambda';
import { ClerkUserUpsertedEventDetail } from './types/eventbridge';
import * as ulid from 'ulid';
import * as Users from './lib/users';

const SUBSCRIPTION_TIERS = {
  'FREE': {
    maxScans: 5,
    filesPerScan: 10,
    maxFileSize: 500_000, // 500 KB
  },
  'PRO': {
    maxScans: 100,
    filesPerScan: 100,
    maxFileSize: 1_000_000, // 1MB
  }
}

type Event = EventBridgeEvent<'user.created' | 'user.updated', ClerkUserUpsertedEventDetail>;

export const handler = async (event: Event) => {
  const email = event.detail.data.data.email_addresses?.[0]?.email_address;
  const clerkUserId = event.detail.data.data.id;
  const githubAccount = event.detail.data.data.external_accounts.find(x => 
    x.provider === 'oauth_github'
  );
  const githubHandle = githubAccount?.username;

  if (!githubHandle) {
  
  }

  const user = await Users.findUser(clerkUserId, email, githubHandle);
  const id = user?.id || ulid.ulid();
  const now = new Date().toJSON();
  
  const tier = user?.tier || 'FREE';
  const subscriptionTier = tier === 'FREE'
    ? SUBSCRIPTION_TIERS.FREE
    : SUBSCRIPTION_TIERS.PRO;
  
  // billing start date should be in 'YYYY-MM-DD' format
  // and every day, we'll reset users who's billing cycle is up
  const billingStartDate = user?.billingStartDate || now.slice(0, 10);
  
  await Users.upsertUser({
    id,
    email,
    username: event.detail.data.data.username,
    clerkUserId: event.detail.data.data.id,
    firstName: event.detail.data.data.first_name,
    lastName: event.detail.data.data.last_name,
    imageUrl: event.detail.data.data.image_url,
    githubHandle,
    createdAt: user?.createdAt || now,
    lastUpdatedAt: now,
    deleted: false,
    tier,
    billingStartDate,
    scanCount: user?.scanCount || 0,
    maxScans: user?.maxScans || subscriptionTier.maxScans,
  });

  return {
    statusCode: 200
  };
}
