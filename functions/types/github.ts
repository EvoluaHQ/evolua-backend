// File change types from GitHub API
export type FileChangeType =
  | "ADDED"
  | "DELETED"
  | "MODIFIED"
  | "RENAMED"
  | "COPIED"
  | "CHANGED"
  | "UNCHANGED";

// Interface for the processed file data
export interface PRFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: FileChangeType;
  sha: string;
  content: string | null;
}

export interface FetchPRFilesResponse {
  repository: {
    pullRequest: {
      headRef: {
        target: {
          oid: string;
        };
      };
      files: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: Array<{
          path: string;
          additions: number;
          deletions: number;
          changeType: FileChangeType;
          commitResourcePath: string;
          patch?: string; // Git diff patch
        }>;
      };
    };
  };
}

export interface FetchPRFileContentResponse {
  repository: {
    object: {
      text: string | null;
      isTruncated: boolean;
      byteSize: number;
    };
  };
}

// Response type interfaces for GraphQL queries and mutations
export interface AddPRReviewResponse {
  addPullRequestReview: {
    pullRequestReview: {
      id: string;
      comments: {
        nodes: Array<{
          id: string;
          body: string;
          path: string;
          line?: number;
        }>;
      };
    };
  };
}

export interface GetPRIDResponse {
  repository: {
    pullRequest: {
      id: string; // GitHub's GraphQL node ID
      headRef: {
        target: {
          oid: string; // This is the HEAD SHA
        };
      };
    };
  };
}

export interface AddCommentResponse {
  addComment: {
    commentEdge: {
      node: {
        id: string;
        body: string;
      };
    };
  };
}

/**
 * Interface for changed lines information
 */
export interface FileChanges {
  lineNumbers: number[];
  chunks: Array<{
    start: number; // Starting line number
    end: number; // Ending line number
    content: string; // Changed content
    header: string; // Chunk header from git diff
    changedLines: number[]; // Add this to track changed lines per chunk
  }>;
}

/**
 * Extended PR file interface with change tracking
 */
export interface PRFileChanges extends PRFile {
  content: string | null;
  changes: FileChanges;
}

export interface GitHubFileResponse {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previous_filename?: string;
}

/**
 * The side of the diff where the comment appears
 */
export type DiffSide = "LEFT" | "RIGHT";

/**
 * Draft Pull Request Review Thread type for GitHub's GraphQL API
 */
export interface DraftPullRequestReviewThread {
  /**
   * Path to the file being commented on (required)
   */
  path: string;

  /**
   * The line number in the file to comment on (required)
   * For multi-line comments, this is the ending line
   */
  line: number;

  /**
   * The side of the diff where the line resides (defaults to RIGHT)
   * For multi-line comments, this is the side for the end line
   */
  side?: DiffSide;

  /**
   * The starting line for multi-line comments (optional)
   * Only needed when commenting on multiple lines
   */
  startLine?: number;

  /**
   * The side of the diff where the start line resides (defaults to RIGHT)
   * Only needed for multi-line comments
   */
  startSide?: DiffSide;

  /**
   * Content of the comment (required)
   */
  body: string;
}
