const { ClerkUserUpsertedEventDetail } = require('./clerk-webook.event');
const ulid = require('ulid');
const Users = require('./lib/users');

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
  });

  return {
    statusCode: 200
  };
}
