import { EventEnvelope, ClerkUserDeletedEventDetail } from "./types";
import { EventBridgeEvent } from "aws-lambda";
import { findUserByClerkUserId, deleteUser } from "./lib/users";

type Event = EventBridgeEvent<"user.deleted", EventEnvelope<ClerkUserDeletedEventDetail>>;

export const handler = async (event: Event) => {
  const clerkUserId = event.detail.data.data.id;
  
  const user = await findUserByClerkUserId(clerkUserId);

  if (user) {
    await deleteUser(user.id);
  }
}
