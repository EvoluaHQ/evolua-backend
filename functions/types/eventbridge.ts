export interface Metadata {
  eventId: string;
  version: string;
  timeStamp: string;
  source: string;
  type: string;
  idempotencyKey?: string;
}

export interface EventEnvelope<TData> {
  metadata: Metadata;
  data: TData;
}

export interface ClerkUserUpsertedEventDetail {
  data: {
    created_at: number;
    email_addresses: {
      email_address: string;
      id: string;
    }[];
    external_accounts: {
      avatar_url: string;
      email_address: string;
      id: string;
      identification_id: string;
      provider: "oauth_github" | string;
      provider_user_id: number;
      username: string; // github handle
    }[];
    id: string; // clerk user id
    username: string;
    first_name: string;
    last_name: string;
    image_url: string;
    last_active_at: number;
    last_sign_in_at: number;
    locked: boolean;
    private_metadata: object;
    public_metadata: object;
  };
  timestamp: number;
  type: string;
}

export interface ClerkUserDeletedEventDetail {
  data: {
    deleted: boolean;
    id: string; // clerk user id
  };
  timestamp: number;
  type: string;
}

// created | updated | deleted events all have the same shape
export interface ClerkOrganizationMembershipChangedEventDetail {
  data: {
    created_at: number;
    id: string; // clerk organization membership id
    organization: {
      admin_delete_enabled: boolean;
      created_at: number;
      id: string; // clerk organization id
      image_url: string;
      max_allowed_memberships: number;
      members_count: number;
      pending_invitations_count: number;
      name: string;
      slug: string;
      updated_at: number;
    };
    public_metadata: object;
    public_user_data: {
      user_id: string; // clerk user id
      identifier: string; // email
      first_name: string;
      last_name: string;
      image_url: string;
    };
    role: "org:admin" | "org:member" | "org:billing";
    role_name: "Admin" | "Member" | "Billing";
    updated_at: number;
  };
  timestamp: number;
  type: string;
}

// created | updated | deleted events all have the same shape
export interface ClerkOrganizationChangedEventDetail {
  data: {
    admin_delete_enabled: boolean;
    created_at: number;
    created_by: string; // clerk user id
    id: string; // clerk organization id
    image_url: string;
    max_allowed_memberships: number;
    name: string;
    slug: string;
    updated_at: number;
    private_metadata: object;
    public_metadata: object;
  };
  timestamp: number;
  type: string;
}

export interface ScanCompletedEventDetail {
  repoId: string;
  scanId: string;
  reviewedAt: string;
  pullRequest: {
    id: string;
    number: number;
    url: string;
    title: string;
    createdAt: string;
  };
  summary: {
    scanId: string;
    timestamp: string;
    filesScanned: number;
    issuesCount: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  reviewedFiles: string[];
}
