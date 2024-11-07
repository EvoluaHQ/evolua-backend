export interface Metadata {
  eventId: string,
  version: string,
  timestamp: string,
  source: string,
  type: string,
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

export interface GitHubPROpenedEventDetail {
  metadata: Metadata,
  data: {
    pull_request: {
      url: string,
      id: number,
      node_id: string,
      title: string,
      created_at: string,
      number: number,
      head: {
        sha: string
      }
    },
    repository: {
      id: number,
      name: string,
      full_name: string,
      git_url: string,
      visibility: string,
      owner: {
        login: string,
        id: number
      }
    },
    organization: {
      login: string,
      id: number,
    },
    sender: {
      login: string,
      id: number,
    },
    installation: {
      id: number
    }  
  }
}

export interface GitHubInstallationEventDetail {
  metadata: Metadata,
  data: {    
    installation: {
      id: number
    },
    repositories_added: {
      full_name: string, // e.g. samuelcastro/jankenpon
      name: string,   // e.g. jankenpon
      id: number,
      node_id: string,
      private: boolean
    }[],
    repositories_removed: {
      full_name: string, // e.g. samuelcastro/jankenpon
      name: string,   // e.g. jankenpon
      id: number,
      node_id: string,
      private: boolean
    }[],
    sender: {
      id: number,
      login: string, // github handle
      node_id: string,
      avatar_url: string,
    }
  }
}
