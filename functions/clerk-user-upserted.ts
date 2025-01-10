import { EventBridgeEvent } from "aws-lambda";
import { ulid } from "ulid";
import { findUser, upsertUser } from "./lib/users";
import { EventEnvelope, ClerkUserUpsertedEventDetail } from "./types";

type ClerkEvent = "user.created" | "user.updated";
type Event = EventBridgeEvent<ClerkEvent, EventEnvelope<ClerkUserUpsertedEventDetail>>;

export const handler = async (event: Event) => {
  const email = event.detail.data.data.email_addresses?.[0]?.email_address;
  const clerkUserId = event.detail.data.data.id;
  const githubAccount = event.detail.data.data.external_accounts.find(
    (x) => x.provider === "oauth_github"
  );
  const githubHandle = githubAccount?.username?.toLowerCase();

  const user = await findUser(clerkUserId, email, githubHandle);
  const id = user?.id || ulid();
  const now = new Date().toJSON();

  const tier = user?.tier || "FREE";

  // billing start date should be in 'YYYY-MM-DD' format
  // and every day, we'll reset users who's billing cycle is up
  const billingStartDate = user?.billingStartDate || now.slice(0, 10);
  
  const freeTrialStartDate = billingStartDate;
  const freeTrialEndDate = new Date(billingStartDate);
  freeTrialEndDate.setMonth(freeTrialEndDate.getMonth() + 1);

  await upsertUser({
    id,
    email,
    username: event.detail.data.data.username,
    clerkUserId: event.detail.data.data.id,
    firstName: event.detail.data.data.first_name,
    lastName: event.detail.data.data.last_name,
    imageUrl: event.detail.data.data.image_url,
    githubHandle: githubHandle || "",
    createdAt: user?.createdAt || now,
    lastUpdatedAt: now,
    deleted: false,
    tier,
    billingStartDate,
    freeTrialStartDate,
    freeTrialEndDate: freeTrialEndDate.toJSON().slice(0, 10),
    scanCount: user?.scanCount || 0,
  });
};
