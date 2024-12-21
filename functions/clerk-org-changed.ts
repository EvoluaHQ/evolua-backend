import { EventBridgeEvent } from "aws-lambda";
import { EventEnvelope, ClerkOrganizationChangedEventDetail } from "./types";
import { 
  getOrganizationByClerkOrgId, 
  getOrganizationMembers,
  putOrganization,
  deleteOrganization,
  deleteOrganizationMembership
} from './lib/organizations';

type ClerkEvent = "organization.updated" | "organization.deleted";
type Event = EventBridgeEvent<ClerkEvent, EventEnvelope<ClerkOrganizationChangedEventDetail>>;

export const handler = async (event: Event) => {
  const clerkOrgId = event.detail.data.data.id;
  const eventType = event.detail.metadata.type;

  if (eventType === "organization.updated") {
    const org = await getOrganizationByClerkOrgId(clerkOrgId);

    if (!org) {
      throw new Error(`Clerk organization id not found: ${clerkOrgId}`);
    }

    await putOrganization({
      orgId: org.orgId,
      name: event.detail.data.data.name,
      clerkOrgId,
      createdAt: org.createdAt,
      lastUpdatedAt: new Date(event.detail.data.data.updated_at).toJSON(),
      maxMembers: event.detail.data.data.max_allowed_memberships,
      status: org.status,
    })
  } else if (eventType === "organization.deleted") {
    const org = await getOrganizationByClerkOrgId(clerkOrgId);
    if (org) {
      const members = await getOrganizationMembers(org.orgId);
      for (const member of members) {
        await deleteOrganizationMembership(member.orgId, member.clerkUserId);
      }

      await deleteOrganization(org.orgId);
    }
  }   
};
