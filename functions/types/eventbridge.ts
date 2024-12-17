export interface Metadata {
  eventId: string;
  version: string;
  timestamp: string;
  source: string;
  type: string;
  idempotencyKey?: string;
}

export interface EventEnvelope<TData> {
  metadata: Metadata;
  data: TData;
}

export interface ClerkUserUpsertedEventDetail {
  metadata: Metadata,
  data: {
    data: {
      created_at: number,
      email_addresses: {
        email_address: string,
        id: string,
      }[],
      external_accounts: {
        avatar_url: string,
        email_address: string,
        id: string,
        identification_id: string,
        provider: 'oauth_github' | string,
        provider_user_id: number,
        username: string, // github handle
      }[],
      id: string, // clerk user id
      username: string,
      first_name: string,
      last_name: string,
      image_url: string,
      last_active_at: number,
      last_sign_in_at: number,
      locked: boolean,
      private_metadata: object,
      public_metadata: object,
    },
    timestamp: number,
    type: string,
  }
}

export interface ClerkUserDeletedEventDetail {
  metadata: Metadata,
  data: {
    data: {
      deleted: boolean,
      id: string, // clerk user id
    },
    timestamp: number,
    type: string,
  }
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
