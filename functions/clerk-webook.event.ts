export interface GitHubEventDetail {
  metadata: {
    eventId: string,
    version: string,
    timestamp: string,
    source: string,
    type: string,
  },
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
