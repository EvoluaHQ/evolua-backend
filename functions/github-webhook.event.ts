export interface Metadata {
  eventId: string,
  version: string,
  timestamp: string,
  source: string,
  type: string,
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
