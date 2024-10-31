const { ClerkUserDeletedEventDetail } = require('./clerk-webook.event');
const Users = require('./lib/users');

/**
 * @param {import('aws-lambda').EventBridgeEvent<'user.deleted', ClerkUserDeletedEventDetail>} event
 */
module.exports.handler = async (event) => {
  const clerkUserId = event.detail.data.data.id;
  
  const user = await Users.findUserByClerkUserId(clerkUserId);

  if (user) {
    await Users.deleteUser(user.id);
  }

  return {
    statusCode: 200
  };
}
