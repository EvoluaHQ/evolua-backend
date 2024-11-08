const { ClerkUserUpsertedEventDetail } = require('./types/eventbridge');
const ulid = require('ulid');
const Users = require('./lib/users');
const { SUBSCRIPTION_TIERS } = require('./lib/constants');

/**
 * @param {import('aws-lambda').EventBridgeEvent<'user.created' | 'user.updated', ClerkUserUpsertedEventDetail>} event
 */
module.exports.handler = async (event) => {
  const email = event.detail.data.data.email_addresses?.[0]?.email_address;
  const clerkUserId = event.detail.data.data.id;
  const githubAccount = event.detail.data.data.external_accounts.find(x => 
    x.provider === 'oauth_github'
  );
  const githubHandle = githubAccount?.username;  

  const user = await Users.findUser(clerkUserId, email, githubHandle);
  const id = user?.id || ulid.ulid();
  const now = new Date().toJSON();
  
  const tier = user?.tier || 'FREE';
  
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
    tier,
    billingStartDate,
    scanCount: user?.scanCount || 0,
    maxScans: user?.maxScans || SUBSCRIPTION_TIERS[tier].maxScans,
  });

  return {
    statusCode: 200
  };
}
