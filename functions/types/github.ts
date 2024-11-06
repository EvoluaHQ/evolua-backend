// File change types from GitHub API
export type FileChangeType =
  | "ADDED"
  | "DELETED"
  | "MODIFIED"
  | "RENAMED"
  | "COPIED"
  | "CHANGED"
  | "UNCHANGED"

// Interface for the processed file data
export interface PRFile {
  path: string
  additions: number
  deletions: number
  changeType: FileChangeType
  sha: string
  content: string | null
}

export interface FetchPRFilesResponse {
  repository: {
    pullRequest: {
      headRef: {
        target: {
          oid: string
        }
      }
      files: {
        pageInfo: {
          hasNextPage: boolean
          endCursor: string | null
        }
        nodes: Array<{
          path: string
          additions: number
          deletions: number
          changeType: FileChangeType
          commitResourcePath: string
          patch?: string // Git diff patch
        }>
      }
    }
  }
}

export interface FetchPRFileContentResponse {
  repository: {
    object: {
      text: string | null
      isTruncated: boolean
      byteSize: number
    }
  }
}

/**
 * Interface for issue references (standards, rules, etc.)
 */
export interface IssueReference {
  standard: string // e.g., "OWASP", "CERT", "ISO-27001"
  rule_id: string // e.g., "A1:2021", "MSC21-C"
}

/**
 * Interface for issue location in code
 */
export interface IssueLocation {
  line_start: number
  line_end: number
}

/**
 * Enum for possible risk levels
 */
export type RiskLevel = "critical" | "high" | "medium" | "low"

/**
 * Enum for issue types
 */
export type IssueType = "vulnerability" | "code_quality" | "best_practice"

export type Recommendation = {
  description: string
  code?: string
}

/**
 * Interface for a single code analysis issue
 */
export interface CodeIssue {
  id: string
  type: IssueType
  risk_level: RiskLevel
  title: string
  location: IssueLocation
  description: string
  impact?: string
  recommendation?: Recommendation
  cwe_id?: string
  references?: IssueReference
}

export interface AnalysisResults {
  summary: {
    total_issues: number
    risk_levels: {
      critical: number
      high: number
      medium: number
      low: number
    }
  }
  issues: CodeIssue[]
}

export interface AnalysisResult {
  file: PRFileChanges // Update to include changes
  findings: AnalysisResults
}

// Response type interfaces for GraphQL queries and mutations
export interface AddPRReviewResponse {
  addPullRequestReview: {
    pullRequestReview: {
      id: string
      comments: {
        nodes: Array<{
          id: string
          body: string
          path: string
          line?: number
        }>
      }
    }
  }
}

export interface GetPRIDResponse {
  repository: {
    pullRequest: {
      id: string // GitHub's GraphQL node ID
    }
  }
}

export interface AddCommentResponse {
  addComment: {
    commentEdge: {
      node: {
        id: string
        body: string
      }
    }
  }
}

export interface PullRequestReviewComment {
  path: string //Path to the file being commented on.
  position: number //Position in the file to leave a comment on.
  body: string //Body of the comment to leave.
}

/**
 * Interface for changed lines information
 */
export interface FileChanges {
  lineNumbers: number[]
  chunks: Array<{
    start: number // Starting line number
    end: number // Ending line number
    content: string // Changed content
    header: string // Chunk header from git diff
    changedLines: number[] // Add this to track changed lines per chunk
  }>
  // Store diff positions at the file level instead of per chunk
  lineToDiffPosition: Map<number, number>
}

/**
 * Extended PR file interface with change tracking
 */
export interface PRFileChanges extends PRFile {
  content: string | null
  changes: FileChanges
}

export interface GitHubFileResponse {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
  previous_filename?: string
}
