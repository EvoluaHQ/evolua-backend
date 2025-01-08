import { EventBridgeEvent } from "aws-lambda";
import { EventEnvelope, ClerkOrganizationMembershipChangedEventDetail } from "./types";
import { 
  getOrganizationByClerkOrgId, 
  putOrganizationMembership,
  deleteOrganizationMembership
} from './lib/organizations';
import { findUserByClerkUserId } from './lib/users';

type ClerkEvent = 
  "organizationMembership.created" | 
  "organizationMembership.deleted" |
  "organizationMembership.updated";
type Event = EventBridgeEvent<ClerkEvent, EventEnvelope<ClerkOrganizationMembershipChangedEventDetail>>;

export const handler = async (event: Event) => {
  const clerkUserId = event.detail.data.data.public_user_data.user_id;
  const user = await findUserByClerkUserId(clerkUserId);
  if (!user) {
    throw new Error(`Clerk user id not found: ${clerkUserId}`);
  }
  
  const clerkOrgId = event.detail.data.data.organization.id;
  const org = await getOrganizationByClerkOrgId(clerkOrgId);
  if (!org) {
    throw new Error(`Clerk organization id not found: ${clerkOrgId}`);
  }

  switch (event.detail.metadata.type) {
    case "organizationMembership.created":
    case "organizationMembership.updated":
      await putOrganizationMembership({
        orgId: org.orgId,
        clerkUserId,
        clerkOrgId,
        role: event.detail.data.data.role_name.toLowerCase() as "admin" | "member" | "billing",
        createdAt: new Date(event.detail.data.data.created_at).toISOString(),
      })

      break;
    case "organizationMembership.deleted":
      await deleteOrganizationMembership(org.orgId, clerkUserId);
      
      break;
    default:
      throw new Error(`Unknown event type: ${event.detail.metadata.type}`);
  }
};
