import { Logger } from "@aws-lambda-powertools/logger";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
/**
 * Fetch all PR files with changes
 */
import { RateLimit, Sema } from "async-sema";
import { chunk } from "lodash";
import {
  AddCommentResponse,
  AddPRReviewResponse,
  AIResponse,
  CodeIssue,
  CreateReviewResponse,
  DraftPullRequestReviewThread,
  ExtendedFileChanges,
  FetchPRFileContentResponse,
  FileChanges,
  FileChangeType,
  Findings,
  GetPRIDResponse,
  GitHubFileResponse,
  PRFileChanges,
  ReviewStats,
  ReviewSummary,
  ScanResult,
} from "../types";
import { getLanguageExtension } from "./utils";

const logger = new Logger();

// Configuration for rate limiting
const GITHUB_API_RATE_LIMIT = {
  maxConcurrent: 5, // Maximum concurrent API calls
  waitTime: 1000, // Time to wait between batches in ms
};

let octokit: Octokit;

export async function init(
  appId: string,
  privateKey: string,
  installationId: number
) {
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  });

  const installationAuth = await auth({ type: "installation" });
  octokit = new Octokit({
    auth: installationAuth.token,
  });

  logger.info("GitHub Octokit initialized");
}

/**
 * Parse patch information to get exact line changes
 * Example patch format:
 * @@ -1,4 +1,4 @@ (means: original starts line 1, 4 lines; new starts line 1, 4 lines)
 *  unchanged line
 * -removed line
 * +added line
 *  unchanged line
 */
function parseFileChanges(patch?: string): FileChanges {
  const changes = {
    lineNumbers: [] as number[],
    chunks: [] as Array<{
      start: number;
      end: number;
      content: string;
      header: string;
      changedLines: number[];
    }>,
  };

  if (!patch) return changes;

  logger.info("Processing patch", { patch });

  const lines = patch.split("\n");
  let currentNewLine = 0;
  let chunkStart = 0;
  let chunkLines: string[] = [];
  let chunkHeader = "";
  let chunkChangedLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse chunk header
    if (line.startsWith("@@")) {
      // Save previous chunk if exists
      if (chunkLines.length > 0) {
        changes.chunks.push({
          start: chunkStart,
          end: currentNewLine,
          content: chunkLines.join("\n"),
          header: chunkHeader,
          changedLines: [...chunkChangedLines],
        });
        chunkLines = [];
        chunkChangedLines = [];
      }

      const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
      if (match) {
        currentNewLine = parseInt(match[2], 10);
        chunkStart = currentNewLine;
        chunkHeader = line;
      }
      continue;
    }

    if (line.startsWith("+")) {
      // Added or modified line
      chunkChangedLines.push(currentNewLine);
      if (!changes.lineNumbers.includes(currentNewLine)) {
        changes.lineNumbers.push(currentNewLine);
      }
      chunkLines.push(line.slice(1));
      currentNewLine++;
    } else if (line.startsWith("-")) {
      // Removed line
      chunkLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      // Context line
      chunkLines.push(line.slice(1));
      currentNewLine++;
    }
  }

  // Add the last chunk
  if (chunkLines.length > 0) {
    changes.chunks.push({
      start: chunkStart,
      end: currentNewLine,
      content: chunkLines.join("\n"),
      header: chunkHeader,
      changedLines: [...chunkChangedLines],
    });
  }

  changes.lineNumbers.sort((a, b) => a - b);

  logger.info("Parsed file changes", {
    totalChangedLines: changes.lineNumbers.length,
    changedLines: changes.lineNumbers,
    chunks: changes.chunks.map((chunk) => ({
      header: chunk.header,
      start: chunk.start,
      end: chunk.end,
      changedLines: chunk.changedLines,
    })),
  });

  return changes;
}

/**
 * Parse patch information to get exact line changes and hunk boundaries
 * Example patch format:
 * @@ -1,4 +1,4 @@ (means: original starts line 1, 4 lines; new starts line 1, 4 lines)
 *  unchanged line
 * -removed line
 * +added line
 *  unchanged line
 */
function parseFileChangesTest(patch?: string): ExtendedFileChanges {
  const changes: ExtendedFileChanges = {
    lineNumbers: [],
    chunks: [],
  };

  if (!patch) return changes;

  logger.info("Processing patch", { patch });

  const lines = patch.split("\n");
  let currentNewLine = 0;
  let chunkStart = 0;
  let hunkStart = 0;
  let hunkEnd = 0;
  let chunkLines: string[] = [];
  let chunkHeader = "";
  let chunkChangedLines: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Parse chunk header
    if (line.startsWith("@@")) {
      // Save previous chunk if exists
      if (chunkLines.length > 0) {
        changes.chunks.push({
          start: chunkStart,
          end: currentNewLine,
          content: chunkLines.join("\n"),
          header: chunkHeader,
          changedLines: [...chunkChangedLines],
          hunkStart,
          hunkEnd,
        });
        chunkLines = [];
        chunkChangedLines = [];
      }

      // Parse the hunk header: @@ -a,b +c,d @@
      const match = line.match(/@@ -\d+,\d+ \+(\d+),(\d+) @@/);
      if (match) {
        const newLineStart = parseInt(match[1], 10);
        const newLineCount = parseInt(match[2], 10);
        currentNewLine = newLineStart;
        chunkStart = currentNewLine;
        chunkHeader = line;
        hunkStart = newLineStart;
        hunkEnd = newLineStart + newLineCount - 1;
      }
      continue;
    }

    if (line.startsWith("+")) {
      // Added or modified line
      chunkChangedLines.push(currentNewLine);
      if (!changes.lineNumbers.includes(currentNewLine)) {
        changes.lineNumbers.push(currentNewLine);
      }
      chunkLines.push(line.slice(1));
      currentNewLine++;
    } else if (line.startsWith("-")) {
      // Removed line
      chunkLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      // Context line
      chunkLines.push(line.slice(1));
      currentNewLine++;
    }
  }

  // Add the last chunk
  if (chunkLines.length > 0) {
    changes.chunks.push({
      start: chunkStart,
      end: currentNewLine,
      content: chunkLines.join("\n"),
      header: chunkHeader,
      changedLines: [...chunkChangedLines],
      hunkStart,
      hunkEnd,
    });
  }

  changes.lineNumbers.sort((a, b) => a - b);

  logger.info("Parsed file changes", {
    totalChangedLines: changes.lineNumbers.length,
    changedLines: changes.lineNumbers,
    chunks: changes.chunks.map((chunk) => ({
      header: chunk.header,
      start: chunk.start,
      end: chunk.end,
      changedLines: chunk.changedLines,
      hunkStart: chunk.hunkStart,
      hunkEnd: chunk.hunkEnd,
    })),
  });

  return changes;
}

function mapChangeType(status: string): FileChangeType {
  const statusMap: Record<string, FileChangeType> = {
    added: "ADDED",
    removed: "DELETED",
    modified: "MODIFIED",
    renamed: "RENAMED",
    copied: "COPIED",
    changed: "CHANGED",
    unchanged: "UNCHANGED",
  };

  return statusMap[status] || "MODIFIED";
}

/**
 * Process a single file's patch
 */
export async function processPRFile(
  file: GitHubFileResponse,
  sha: string
): Promise<PRFileChanges> {
  const changes = parseFileChangesTest(file.patch);

  logger.info("File changes processed", {
    file: file.filename,
    changedLines: changes.lineNumbers,
    chunksCount: changes.chunks.length,
    chunks: changes.chunks.map((chunk) => ({
      header: chunk.header,
      start: chunk.start,
      end: chunk.end,
      changedLines: chunk.changedLines,
      linesCount: chunk.content.split("\n").length,
    })),
  });

  return {
    path: file.filename,
    additions: file.additions,
    deletions: file.deletions,
    changeType: mapChangeType(file.status),
    sha,
    content: null, // Will be filled later if needed
    changes,
  };
}

export async function commentOnPR(pullRequestId: string, comment: string) {
  const mutation = `
    mutation($input: AddCommentInput!) {
      addComment(input: $input) {
        commentEdge {
          node {
            id
            body
          }
        }
      }
    }
  `;

  try {
    const response = await octokit.graphql<AddCommentResponse>(mutation, {
      input: {
        body: comment,
        subjectId: pullRequestId,
      },
    });

    const commentId = response.addComment.commentEdge.node.id;

    logger.info("Comment added successfully", {
      commentId,
      pullRequestId,
    });

    return commentId;
  } catch (err) {
    logger.error("Failed to send comment", err as Error);
    throw err;
  }
}

export async function deleteCommentOnPR(commentId: string) {
  const mutation = `
    mutation($id: ID!) {
      deleteIssueComment(input: { id: $id }) {
        clientMutationId
      }
    }
  `;

  try {
    await octokit.graphql(mutation, { id: commentId });

    logger.info("Comment deleted successfully", { commentId });
  } catch (err) {
    logger.error("Failed to delete comment", err as Error);
  }
}

async function fetchPRFileContent(
  owner: string,
  repo: string,
  filePath: string,
  sha: string
): Promise<string | null> {
  const query = `
    query ($owner: String!, $repo: String!, $expression: String!) {
      repository(owner: $owner, name: $repo) {
        object(expression: $expression) {
          ... on Blob {
            text
            isTruncated
            byteSize
          }
        }
      }
    }
  `;
  try {
    const response = await octokit.graphql<FetchPRFileContentResponse>(query, {
      owner,
      repo,
      expression: `${sha}:${filePath}`,
    });

    if (response.repository.object?.isTruncated) {
      logger.warn("File content truncated", {
        filePath,
        byteSize: response.repository.object.byteSize,
      });
    }

    return response.repository.object?.text ?? null;
  } catch (error) {
    logger.error("Failed to fetch file content", error as Error);
    return null;
  }
}

export async function fetchPRDetails(
  owner: string,
  repo: string,
  prNumber: number
) {
  const { data } = await octokit.request(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    {
      owner,
      repo,
      pull_number: prNumber,
      headers: {
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  return data;
}

/**
 * Fetch all PR files with changes.
 * Process files with rate limiting.
 */
export async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFileChanges[]> {
  try {
    let page = 1;
    const perPage = 100;
    const files: PRFileChanges[] = [];
    let hasNextPage = true;

    // Create semaphores for different API operations
    const processSemaphore = new Sema(GITHUB_API_RATE_LIMIT.maxConcurrent, {
      capacity: 100, // Allow queuing of requests
    });

    const contentSemaphore = new Sema(GITHUB_API_RATE_LIMIT.maxConcurrent, {
      capacity: 100,
    });

    // Get the PR commit SHA first
    const shaResponse = await octokit.graphql<{
      repository: {
        pullRequest: {
          headRef: {
            target: {
              oid: string;
            };
          };
        };
      };
    }>(
      `
      query($owner: String!, $repo: String!, $prNumber: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            headRef {
              target {
                oid
              }
            }
          }
        }
      }
    `,
      {
        owner,
        repo,
        prNumber,
      }
    );

    const sha = shaResponse.repository.pullRequest.headRef.target.oid;

    while (hasNextPage) {
      // Fetch files for current page
      const { data: filesPage, headers } = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
        {
          owner,
          repo,
          pull_number: prNumber,
          per_page: perPage,
          page,
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      // Process files with rate limiting
      const processWithRateLimit = async (file: GitHubFileResponse) => {
        await processSemaphore.acquire();
        try {
          return await processPRFile(file, sha);
        } finally {
          processSemaphore.release();
        }
      };

      const processedFiles = await Promise.all(
        filesPage.map((file) => processWithRateLimit(file))
      );

      // Get file contents with rate limiting
      const fetchContentWithRateLimit = async (file: PRFileChanges) => {
        await contentSemaphore.acquire();
        try {
          file.content = await fetchPRFileContent(owner, repo, file.path, sha);
          return file;
        } finally {
          contentSemaphore.release();
        }
      };

      // Only fetch content for files with changes
      const filesWithContent = await Promise.all(
        processedFiles
          .filter(hasChanges)
          .map((file) => fetchContentWithRateLimit(file))
      );

      files.push(...filesWithContent);

      // Check for next page
      const links = headers.link;
      hasNextPage = !!(links && links.includes('rel="next"'));
      if (hasNextPage) page++;

      // Log progress
      logger.info("Processed PR files page", {
        page,
        filesInPage: filesWithContent.length,
        totalFiles: files.length,
        filesWithChanges: filesWithContent.filter(hasChanges).length,
      });

      // Add a small delay between pages to be extra careful with rate limits
      if (hasNextPage) {
        await new Promise((resolve) =>
          setTimeout(resolve, GITHUB_API_RATE_LIMIT.waitTime)
        );
      }
    }

    // Log summary of processed files
    const filesWithChanges = files.filter(hasChanges);
    logger.info("Completed processing PR files", {
      totalFiles: files.length,
      filesWithChanges: filesWithChanges.length,
      totalChunks: files.reduce(
        (sum, file) => sum + file.changes.chunks.length,
        0
      ),
    });

    return files;
  } catch (error) {
    logger.error("Failed to fetch PR files", {
      error: error as Error,
      owner,
      repo,
      prNumber,
    });
    return [];
  }
}

/**
 * Helper function to check if file has changes
 */
function hasChanges(file: PRFileChanges): boolean {
  return file.changes.lineNumbers.length > 0;
}

/**
 * Helper function to get total changed lines
 */
function getChangedLinesCount(file: PRFileChanges): number {
  return file.changes.lineNumbers.length;
}

/**
 * Create a pull request review with multiple comments using GraphQL
 */
export async function createPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  prId: string,
  commitId: string,
  comments: DraftPullRequestReviewThread[],
  results: ScanResult[]
) {
  const mutation = `
    mutation($input: AddPullRequestReviewInput!) {
      addPullRequestReview(input: $input) {
        pullRequestReview {
          id
          comments(first: 100) {
            nodes {
              id
              body
              path
              line
            }
          }
        }
      }
    }
  `;

  try {
    const summary = prepareReviewSummary(results);

    const response = await octokit.graphql<AddPRReviewResponse>(mutation, {
      input: {
        pullRequestId: prId,
        commitOID: commitId,
        body: summary,
        threads: comments,
        event: "COMMENT",
      },
    });

    logger.info("Created PR review with comments", {
      reviewId: response.addPullRequestReview.pullRequestReview.id,
      commentsCount:
        response.addPullRequestReview.pullRequestReview.comments.nodes.length,
    });

    return response;
  } catch (error) {
    logger.error("Failed to create PR review", error as Error);

    logger.info("List of comments", {
      comments,
    });

    throw error;
  }
}

export async function createPaginatedPRReview1(
  owner: string,
  repo: string,
  prNumber: number,
  prId: string,
  commitId: string,
  comments: DraftPullRequestReviewThread[],
  results: ScanResult[]
): Promise<CreateReviewResponse[]> {
  const CHUNK_SIZE = 50; // Adjust based on GitHub's limits
  const REQUESTS_PER_SECOND = 1 / 3; // One request every 3 seconds (~0.333 RPS)

  const mutation = `
    mutation($input: AddPullRequestReviewInput!) {
      addPullRequestReview(input: $input) {
        pullRequestReview {
          id
          comments(first: 100) {
            nodes {
              id
              body
              path
              line
            }
          }
        }
      }
    }
  `;

  // Create chunks of comments
  const commentChunks = chunk(comments, CHUNK_SIZE);
  logger.info(
    `Split comments into ${commentChunks.length} chunks of size ${CHUNK_SIZE}`
  );

  // Initialize rate limiter
  const rateLimit = RateLimit(REQUESTS_PER_SECOND);

  // Prepare the summary only once
  const summary = prepareReviewSummary(results);

  // Process each chunk with semaphore control
  const reviewPromises = commentChunks.map(async (commentChunk, index) => {
    await rateLimit(); // Wait for rate limit

    try {
      const chunkSummary =
        index === 0
          ? summary
          : `Continued review part ${index + 1}/${commentChunks.length}`;

      const response = await octokit.graphql<AddPRReviewResponse>(mutation, {
        input: {
          pullRequestId: prId,
          commitOID: commitId,
          body: chunkSummary,
          threads: commentChunk,
          event: "COMMENT",
        },
      });

      const reviewResponse: CreateReviewResponse = {
        reviewId: response.addPullRequestReview.pullRequestReview.id,
        commentsCount:
          response.addPullRequestReview.pullRequestReview.comments.nodes.length,
      };

      logger.info(
        `Created PR review chunk ${index + 1}/${commentChunks.length}`,
        {
          reviewResponse,
        }
      );

      return reviewResponse;
    } catch (error) {
      logger.error(
        `Failed to create PR review chunk ${index + 1}/${commentChunks.length}`,
        {
          error: error as Error,
          commentCount: commentChunk.length,
        }
      );

      // TODO: Adding this only for debugging error: Pull request review thread start line must be part of the same hunk as the line.
      // Remove asap
      logger.info(
        `List of comments chunk ${index + 1}/${commentChunks.length}`,
        {
          comments: commentChunk,
        }
      );
      throw error;
    }
  });

  try {
    // Wait for all chunks to be processed
    const results = await Promise.all(reviewPromises);

    const totalComments = results.reduce(
      (sum, result) => sum + result.commentsCount,
      0
    );

    logger.info("Completed creating all PR reviews", {
      totalChunks: commentChunks.length,
      totalCommentsProcessed: totalComments,
    });

    return results;
  } catch (error) {
    logger.error(
      "Failed to create one or more PR review chunks",
      error as Error
    );
    throw error;
  }
}

export async function createPaginatedPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  prId: string,
  commitId: string,
  comments: DraftPullRequestReviewThread[],
  scanResults: ScanResult[]
): Promise<CreateReviewResponse[]> {
  const CHUNK_SIZE = 30;
  const REQUESTS_PER_SECOND = 1 / 30; // 30s
  const MAX_RETRIES = 3;

  const mutation = `
    mutation($input: AddPullRequestReviewInput!) {
      addPullRequestReview(input: $input) {
        pullRequestReview {
          id
          comments(first: 100) {
            nodes {
              id
              body
              path
              line
            }
          }
        }
      }
    }
  `;

  const commentChunks = chunk(comments, CHUNK_SIZE);
  const rateLimit = RateLimit(REQUESTS_PER_SECOND);
  const summary = prepareReviewSummary(scanResults);
  const results: CreateReviewResponse[] = [];

  logger.info(
    `Split comments into ${commentChunks.length} chunks of size ${CHUNK_SIZE}`
  );

  function getProgressMessage(chunk: number, total: number): string {
    const percent = Math.round((chunk / total) * 100);
    return `Still reviewing your PR! 🔍 Processing part ${chunk} of ${total} (${percent}% done). This might take a few minutes since it's a big PR. I'm being careful to respect GitHub's rate limits to ensure all findings get posted properly.`;
  }

  function getRetryMessage(delay: number): string {
    const minutes = Math.round(delay / 60000);
    return `GitHub needs a short break 😅 I'll wait ${minutes} ${minutes === 1 ? "minute" : "minutes"} before continuing with the review. Don't worry, I'll get through all of it!`;
  }

  async function submitReviewWithRetry(
    commentChunk: DraftPullRequestReviewThread[],
    chunkIndex: number,
    retryCount = 0
  ): Promise<void> {
    try {
      await rateLimit();

      const response = await octokit.graphql<AddPRReviewResponse>(mutation, {
        input: {
          pullRequestId: prId,
          commitOID: commitId,
          body:
            chunkIndex === 0
              ? summary
              : getProgressMessage(chunkIndex + 1, commentChunks.length),
          threads: commentChunk,
          event: "COMMENT",
        },
      });

      const reviewResponse: CreateReviewResponse = {
        reviewId: response.addPullRequestReview.pullRequestReview.id,
        commentsCount:
          response.addPullRequestReview.pullRequestReview.comments.nodes.length,
      };

      logger.info(
        `Created PR review chunk ${chunkIndex + 1}/${commentChunks.length}`,
        {
          reviewResponse,
        }
      );

      results.push(reviewResponse);
    } catch (error) {
      const err = error as Error;
      if (
        err.message.includes("submitted too quickly") &&
        retryCount < MAX_RETRIES
      ) {
        const delay = Math.pow(2, retryCount) * 30000;
        logger.warn(`Rate limited, retrying after ${delay / 1000}s`, {
          chunkIndex: chunkIndex + 1,
          retryCount: retryCount + 1,
        });

        await octokit.graphql(mutation, {
          input: {
            pullRequestId: prId,
            commitOID: commitId,
            body: getRetryMessage(delay),
            threads: [],
            event: "COMMENT",
          },
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        return submitReviewWithRetry(commentChunk, chunkIndex, retryCount + 1);
      }
      throw error;
    }
  }

  for (let i = 0; i < commentChunks.length; i++) {
    await submitReviewWithRetry(commentChunks[i], i);
  }

  logger.info("Completed creating all PR reviews", {
    totalChunks: commentChunks.length,
    totalCommentsProcessed: results.reduce(
      (sum, r) => sum + r.commentsCount,
      0
    ),
  });

  return results;
}

/**
 * Format an issue into a review comment with MDX
 */
export function formatIssueComment(issue: CodeIssue, filePath: string): string {
  const severityEmoji =
    {
      critical: "🚨",
      high: "⚠️",
      medium: "⚡",
      low: "ℹ️",
    }[issue.riskLevel.toLowerCase()] || "🔍";

  let comment = `_${severityEmoji} ${issue.title}_\n\n`;

  // Main description
  comment += `**${issue.description}**\n\n`;

  // Impact section
  if (issue.impact) {
    comment += `### Impact\n${issue.impact}\n\n`;
  }

  // Reference section (if CWE or other references exist)
  if (issue.cweId || (issue.reference?.name && issue.reference?.url)) {
    comment += "### References\n";
    if (issue.cweId) {
      comment += `- [${issue.cweId}](https://cwe.mitre.org/data/definitions/${issue.cweId.replace("CWE-", "")}.html)\n`;
    }
    if (issue.reference?.name && issue.reference?.url) {
      comment += `- [${issue?.reference?.name}](${issue?.reference?.url})\n`;
    }
    comment += "\n";
  }

  // Recommendation section with suggestion block
  if (issue?.recommendation?.description) {
    comment += `### Recommendation\n${issue.recommendation.description}\n`;

    const code = issue?.recommendation?.code?.trim();

    // Only add suggestion block if we have valid suggestion code
    if (code) {
      comment += `
<!-- code snippet -->
\`\`\`${getLanguageExtension(filePath)}
${code}
\`\`\`
<!-- code snippet ends -->
\n\n
<!-- suggestion_start -->
<details>
<summary>📝 Suggested fix</summary>

> ‼️ **IMPORTANT**
> Please review this suggestion carefully before applying:
> - Verify it matches your codebase standards
> - Ensure it doesn't introduce new issues
> - Test thoroughly after applying

\`\`\`suggestion
${issue?.recommendation?.code?.trim()}
\`\`\`

</details>
<!-- suggestion_end -->
`;
    }
  }

  comment += "\n<!-- This is an auto-generated comment by Evolua -->";

  return comment;
}

/**
 * Queries pull request ID needed for review creation
 */
async function getPullRequestInfo(
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ id: string; sha: string }> {
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        headRef {
          target {
            ... on Commit {
              oid
            }
          }
        }
      }
    }
  }`;

  try {
    const response = await octokit.graphql<GetPRIDResponse>(query, {
      owner,
      repo,
      number: prNumber,
    });

    return {
      id: response.repository.pullRequest.id,
      sha: response.repository.pullRequest.headRef?.target?.oid,
    };
  } catch (error) {
    logger.error("Failed to fetch PR INFO", error as Error);
    throw error;
  }
}

/**
 * Submit a complete review for multiple files
 */
export async function submitPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  results: ScanResult[]
) {
  try {
    // Use flatMap to transform and flatten in one operation
    const comments: DraftPullRequestReviewThread[] = results
      .filter(({ file }) => hasChanges(file))
      .flatMap(({ file, findings }) =>
        findings.issues
          .filter((issue) =>
            file.changes.lineNumbers.includes(issue.location.lineStart)
          )
          .map((issue) => {
            const lineStart = issue.location?.lineStart ?? 0;
            const lineEnd = issue.location?.lineEnd ?? lineStart;
            const isSameLine = lineStart === lineEnd;
            const comment = {
              path: file.path,
              body: formatIssueComment(issue, file.path),
            };

            return isSameLine
              ? {
                  ...comment,
                  line: lineStart,
                }
              : {
                  ...comment,
                  startLine: lineStart,
                  line: lineEnd,
                };
          })
          .filter(
            (comment): comment is DraftPullRequestReviewThread =>
              comment !== null &&
              !!comment.path &&
              !!comment.line &&
              !!comment.body
          )
      );

    if (comments.length === 0) {
      logger.info("No valid issues found in changed lines");
      return;
    }

    logger.info("Prepared PR review comments", {
      totalComments: comments.length,
      commentsByFile: comments.reduce(
        (acc, comment) => {
          acc[comment.path] = (acc[comment.path] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
    });

    const { id: prId, sha: commitId } = await getPullRequestInfo(
      owner,
      repo,
      prNumber
    ).catch((error) => {
      logger.error("Failed to get PR info", { error, owner, repo, prNumber });
      throw new Error("Failed to get pull request information");
    });

    await createPaginatedPRReview(
      owner,
      repo,
      prNumber,
      prId,
      commitId,
      comments,
      results
    );

    logger.info("Successfully submitted PR review", {
      totalComments: comments.length,
    });
  } catch (error) {
    logger.error("Failed to submit PR review", error as Error);
    throw error;
  }
}

/**
 * Submit a complete review for multiple files
 */
export async function submitPRReviewTest(
  owner: string,
  repo: string,
  prNumber: number,
  results: ScanResult[]
) {
  try {
    // Transform and filter comments ensuring they're within valid hunks
    const comments: DraftPullRequestReviewThread[] = results
      .filter(({ file }) => hasChanges(file))
      .flatMap(({ file, findings }) =>
        findings.issues
          // First verify the line was actually changed
          .filter((issue) =>
            file.changes.lineNumbers.includes(issue.location.lineStart)
          )
          // Then check if start and end lines are in the same chunk
          .map((issue) => {
            const lineStart = issue.location?.lineStart ?? 0;
            const lineEnd = issue.location?.lineEnd ?? lineStart;

            // Find chunk that contains both start and end lines
            const validChunk = file.changes.chunks.find(
              (chunk) =>
                lineStart >= chunk.hunkStart &&
                lineStart <= chunk.hunkEnd &&
                lineEnd >= chunk.hunkStart &&
                lineEnd <= chunk.hunkEnd
            );

            // Skip if no valid chunk found
            if (!validChunk) {
              logger.info("Skipping comment - lines not in same hunk", {
                path: file.path,
                lineStart,
                lineEnd,
                issue: issue.title,
              });
              return null;
            }

            const comment = {
              path: file.path,
              body: formatIssueComment(issue, file.path),
            };

            return lineStart === lineEnd
              ? {
                  ...comment,
                  line: lineStart,
                }
              : {
                  ...comment,
                  startLine: lineStart,
                  line: lineEnd,
                };
          })
          .filter(
            (comment): comment is DraftPullRequestReviewThread =>
              comment !== null &&
              !!comment.path &&
              !!comment.line &&
              !!comment.body
          )
      );

    if (comments.length === 0) {
      logger.info("No valid issues found in changed lines");
      return;
    }

    logger.info("Prepared PR review comments", {
      totalComments: comments.length,
      commentsByFile: comments.reduce(
        (acc, comment) => {
          acc[comment.path] = (acc[comment.path] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      ),
    });

    const { id: prId, sha: commitId } = await getPullRequestInfo(
      owner,
      repo,
      prNumber
    ).catch((error) => {
      logger.error("Failed to get PR info", { error, owner, repo, prNumber });
      throw new Error("Failed to get pull request information");
    });

    await createPaginatedPRReview(
      owner,
      repo,
      prNumber,
      prId,
      commitId,
      comments,
      results
    );

    logger.info("Successfully submitted PR review", {
      totalComments: comments.length,
    });
  } catch (error) {
    logger.error("Failed to submit PR review", error as Error);
    throw error;
  }
}

export function processAIResponse(rawResponse: AIResponse): Findings {
  return {
    summary: {
      totalIssues: rawResponse.summary?.total_issues || 0,
      riskLevels: {
        critical: rawResponse.summary?.risk_levels?.critical || 0,
        high: rawResponse.summary?.risk_levels?.high || 0,
        medium: rawResponse.summary?.risk_levels?.medium || 0,
        low: rawResponse.summary?.risk_levels?.low || 0,
      },
    },
    issues: rawResponse.issues?.map((issue) => ({
      id: issue.id,
      type: issue.type,
      riskLevel: issue.risk_level,
      title: issue.title,
      location: {
        lineStart: issue.location.line_start,
        lineEnd: issue.location.line_end,
      },
      description: issue.description,
      impact: issue.impact,
      recommendation: {
        description: issue.recommendation.description,
        code: issue.recommendation.code,
      },
      cweId: issue.cwe_id,
      reference: issue.reference
        ? {
            name: issue.reference.name,
            url: issue.reference.url,
          }
        : undefined,
    })),
  };
}

export interface GitHubUserPermissions {
  admin: boolean;
  maintain: boolean;
  push: boolean;
  triage: boolean;
  pull: boolean;
}

export async function getUserPermissions(
  userAccessToken: string,
  repoId: number
): Promise<GitHubUserPermissions> {
  try {
    const userOctokit = new Octokit({
      auth: userAccessToken,
    });

    const repoResponse = await userOctokit.request(
      "GET /repositories/{repo_id}",
      {
        repo_id: repoId,
      }
    );
    const repo = repoResponse.data;

    return repo.permissions;
  } catch (error) {
    logger.error("Failed to get user permissions", error as Error);

    return {
      admin: false,
      maintain: false,
      push: false,
      triage: false,
      pull: false,
    };
  }
}

function formatReviewSummary(summary: ReviewSummary): string {
  return `### Code Review Summary

**Analysis Results:**
${summary.totalIssues} issues found (${summary.riskLevels.critical} critical, ${summary.riskLevels.high} high, ${summary.riskLevels.medium} medium, ${summary.riskLevels.low} low)

#### Key Findings (Critical & High):
${summary.keyFindings.map((finding) => `- ${finding}`).join("\n")}

<details>
  <summary>Files Analyzed</summary>

| File Path | Changes | Issues Found |
|-----------|---------|--------------|
${summary.files.map((file) => `| ${file.path} | ${file.changes} | ${file.issues} |`).join("\n")}

</details>

---
> This analysis was performed by Evolua. For support, please contact our team.
> - Email us @ support@evolua.io
> - Run: **/evolua-review** to start a new code review.
> - Visit [Evolua](https://evolua.io) for more information`;
}

function prepareReviewSummary(results: ScanResult[]): string {
  // File statistics remain the same
  const fileStats: ReviewStats[] = results.map((result) => ({
    path: result.file.path,
    changes: result.file.changes.lineNumbers.length,
    issues: result.findings.issues.length,
  }));

  // Aggregate totals remain the same
  const { totalIssues, riskLevels } = results.reduce(
    (acc, { findings }) => ({
      totalIssues: acc.totalIssues + findings.summary.totalIssues,
      riskLevels: {
        critical:
          acc.riskLevels.critical + findings.summary.riskLevels.critical,
        high: acc.riskLevels.high + findings.summary.riskLevels.high,
        medium: acc.riskLevels.medium + findings.summary.riskLevels.medium,
        low: acc.riskLevels.low + findings.summary.riskLevels.low,
      },
    }),
    {
      totalIssues: 0,
      riskLevels: { critical: 0, high: 0, medium: 0, low: 0 },
    }
  );

  // Enhanced key findings with links
  const keyFindings = results
    .flatMap((result) =>
      result.findings.issues
        .filter(
          (issue) =>
            issue.riskLevel.toLowerCase() === "critical" ||
            issue.riskLevel.toLowerCase() === "high"
        )
        .map((issue) => `${issue.title} in ${result.file.path}`)
    )
    .slice(0, 5);

  const summary = {
    totalIssues,
    riskLevels,
    files: fileStats,
    keyFindings,
  };

  return formatReviewSummary(summary);
}
