import { ClerkUserDeletedEventDetail } from './types/eventbridge';
import { EventBridgeEvent } from 'aws-lambda';
import * as Users from './lib/users';

type Event = EventBridgeEvent<'user.deleted', ClerkUserDeletedEventDetail>;

export const handler = async (event: Event) => {
  const clerkUserId = event.detail.data.data.id;
  
  const user = await Users.findUserByClerkUserId(clerkUserId);

  if (user) {
    await Users.deleteUser(user.id);
  }

  return {
    statusCode: 200
  };
}
