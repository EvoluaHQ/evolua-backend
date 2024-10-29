import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();

let octokit: Octokit;

export async function init(appId: string, privateKey: string, installationId: number) {
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const installationAuth = await auth({ type: "installation" });
  octokit = new Octokit({
    auth: installationAuth.token,
  });

  logger.debug('GitHub Octokit initialized');
}

export async function commentOnPR(pullRequestId: string, comment: string) {
  const mutation = `
    mutation($input: AddCommentInput!) {
      addComment(input: $input) {
        commentEdge {
          node {
            body
          }
        }
      }
    }
  `;

  try {

    const resp = await octokit.graphql(mutation, {
      input: {
        body: comment,
        subjectId: pullRequestId
      }
    });
    console.log('sent comment');
  } catch (err) {
    console.log('failed to send comment', err);
  }
}

// File change types from GitHub API
type FileChangeType = "ADDED" | "DELETED" | "MODIFIED" | "RENAMED" | "COPIED" | "CHANGED" | "UNCHANGED";

// Interface for the processed file data
interface PRFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: FileChangeType;
  sha: string;
  content: string | null;
}

interface FetchPRFilesResponse {
  repository: {
    pullRequest: {
      headRef: {
        target: {
          oid: string;
        };
      },
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
        }>;
      };
    };
  };
}

interface FetchPRFileContentResponse {
  repository: {
    object: {
      text: string;
    };
  };
}

async function fetchPRFileContent(
  owner: string,
  repo: string,
  filePath: string,
  sha: string
): Promise<string> {
  const query = `
    query ($owner: String!, $repo: String!, $expression: String!) {
      repository(owner: $owner, name: $repo) {
        object(expression: $expression) {
          ... on Blob {
            text
          }
        }
      }
    }
  `;

  const response = await octokit.graphql<FetchPRFileContentResponse>(query, {
    owner,
    repo,
    expression: `${sha}:${filePath}`,
  });

  return response.repository.object?.text ?? null;
}

export async function fetchPRFiles(owner: string, repo: string, prNumber: number): Promise<PRFile[]> {
  const query = `
    query getPRFiles($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          headRef {
            target {
              oid
            }
          }
          files(first: 100, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              path
              additions
              deletions
              changeType
            }
          }
        }
      }
    }
  `;

  const files: PRFile[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let sha: string;

  while (hasNextPage) {
    const response: FetchPRFilesResponse = await octokit.graphql<FetchPRFilesResponse>(query, {
      owner,
      repo,
      prNumber,
      cursor
    });

    sha = response.repository.pullRequest.headRef.target.oid;
    const prFiles = response.repository.pullRequest.files;
    
    // Add files from current page to our collection
    const fetchContentPromises = prFiles.nodes.map(async file => {
      const content = await fetchPRFileContent(owner, repo, file.path, sha);
      return {
        ...file,
        content,
        sha
      };
    });

    const newFiles = await Promise.all(fetchContentPromises);
    files.push(...newFiles);

    // Update pagination info
    hasNextPage = prFiles.pageInfo.hasNextPage;
    cursor = prFiles.pageInfo.endCursor;
  }

  return files;
}
