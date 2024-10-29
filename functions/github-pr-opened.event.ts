export interface GitHubEventDetail {
  metadata: {
    eventId: string,
    version: string,
    timestamp: string,
    source: string,
    type: string,
  },
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
