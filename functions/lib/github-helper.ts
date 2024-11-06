import { Logger } from "@aws-lambda-powertools/logger"
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/core"
/**
 * Fetch all PR files with changes
 */
import { Sema } from "async-sema"
import {
  AddCommentResponse,
  AddPRReviewResponse,
  AIResponse,
  AnalysisResults,
  CodeIssue,
  FetchPRFileContentResponse,
  FileChanges,
  FileChangeType,
  GetPRIDResponse,
  GitHubFileResponse,
  PRFileChanges,
  PullRequestReviewComment,
} from "../types"

const logger = new Logger()

// Configuration for rate limiting
const API_RATE_LIMIT = {
  maxConcurrent: 5, // Maximum concurrent API calls
  waitTime: 1000, // Time to wait between batches in ms
}

let octokit: Octokit

export async function init(
  appId: string,
  privateKey: string,
  installationId: number
) {
  const auth = createAppAuth({
    appId,
    privateKey,
    installationId,
  })

  const installationAuth = await auth({ type: "installation" })
  octokit = new Octokit({
    auth: installationAuth.token,
  })

  logger.info("GitHub Octokit initialized")
}

/**
 * Parse patch information to get exact line changes and their diff positions
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
      start: number
      end: number
      content: string
      header: string
      changedLines: number[]
    }>,
    lineToDiffPosition: new Map<number, number>(),
  }

  if (!patch) return changes

  logger.info("Processing patch", { patch })

  const lines = patch.split("\n")
  let currentNewLine = 0
  let chunkStart = 0
  let chunkLines: string[] = []
  let chunkHeader = ""
  let chunkChangedLines: number[] = []
  let currentDiffPosition = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

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
        })
        chunkLines = []
        chunkChangedLines = []
      }

      const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/)
      if (match) {
        currentNewLine = parseInt(match[2], 10)
        chunkStart = currentNewLine
        chunkHeader = line
        currentDiffPosition = 1 // Reset diff position for new chunk
      }
      continue
    }

    if (line.startsWith("+")) {
      // Added or modified line
      changes.lineToDiffPosition.set(currentNewLine, currentDiffPosition)
      chunkChangedLines.push(currentNewLine)
      if (!changes.lineNumbers.includes(currentNewLine)) {
        changes.lineNumbers.push(currentNewLine)
      }
      chunkLines.push(line.slice(1))
      currentNewLine++
      currentDiffPosition++
    } else if (line.startsWith("-")) {
      // Removed line - only increment diff position
      chunkLines.push(line.slice(1))
      currentDiffPosition++
    } else if (line.startsWith(" ")) {
      // Context line
      changes.lineToDiffPosition.set(currentNewLine, currentDiffPosition)
      chunkLines.push(line.slice(1))
      currentNewLine++
      currentDiffPosition++
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
    })
  }

  changes.lineNumbers.sort((a, b) => a - b)

  logger.info("Parsed file changes", {
    totalChangedLines: changes.lineNumbers.length,
    changedLines: changes.lineNumbers,
    diffPositions: Array.from(changes.lineToDiffPosition.entries()),
    chunks: changes.chunks.map((chunk) => ({
      header: chunk.header,
      start: chunk.start,
      end: chunk.end,
      changedLines: chunk.changedLines,
    })),
  })

  return changes
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
  }

  return statusMap[status] || "MODIFIED"
}

/**
 * Process a single file's patch
 */
export async function processPRFile(
  file: GitHubFileResponse,
  sha: string
): Promise<PRFileChanges> {
  const changes = parseFileChanges(file.patch)

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
  })

  return {
    path: file.filename,
    additions: file.additions,
    deletions: file.deletions,
    changeType: mapChangeType(file.status),
    sha,
    content: null, // Will be filled later if needed
    changes,
  }
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
  `

  try {
    const response = await octokit.graphql<AddCommentResponse>(mutation, {
      input: {
        body: comment,
        subjectId: pullRequestId,
      },
    })

    logger.info("Comment added successfully", {
      commentId: response.addComment.commentEdge.node.id,
      pullRequestId,
    })

    return response
  } catch (err) {
    logger.error("Failed to send comment", err as Error)
    throw err
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
  `
  try {
    const response = await octokit.graphql<FetchPRFileContentResponse>(query, {
      owner,
      repo,
      expression: `${sha}:${filePath}`,
    })

    if (response.repository.object?.isTruncated) {
      logger.warn("File content truncated", {
        filePath,
        byteSize: response.repository.object.byteSize,
      })
    }

    return response.repository.object?.text ?? null
  } catch (error) {
    logger.error("Failed to fetch file content", error as Error)
    return null
  }
}

/**
 * Process files with rate limiting
 */
export async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFileChanges[]> {
  try {
    let page = 1
    const perPage = 100
    const files: PRFileChanges[] = []
    let hasNextPage = true

    // Create semaphores for different API operations
    const processSemaphore = new Sema(API_RATE_LIMIT.maxConcurrent, {
      capacity: 100, // Allow queuing of requests
    })

    const contentSemaphore = new Sema(API_RATE_LIMIT.maxConcurrent, {
      capacity: 100,
    })

    // Get the PR commit SHA first
    const shaResponse = await octokit.graphql<{
      repository: {
        pullRequest: {
          headRef: {
            target: {
              oid: string
            }
          }
        }
      }
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
    )

    const sha = shaResponse.repository.pullRequest.headRef.target.oid

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
      )

      // Process files with rate limiting
      const processWithRateLimit = async (file: GitHubFileResponse) => {
        await processSemaphore.acquire()
        try {
          return await processPRFile(file, sha)
        } finally {
          processSemaphore.release()
        }
      }

      const processedFiles = await Promise.all(
        filesPage.map((file) => processWithRateLimit(file))
      )

      // Get file contents with rate limiting
      const fetchContentWithRateLimit = async (file: PRFileChanges) => {
        await contentSemaphore.acquire()
        try {
          file.content = await fetchPRFileContent(owner, repo, file.path, sha)
          return file
        } finally {
          contentSemaphore.release()
        }
      }

      // Only fetch content for files with changes
      const filesWithContent = await Promise.all(
        processedFiles
          .filter(hasChanges)
          .map((file) => fetchContentWithRateLimit(file))
      )

      files.push(...filesWithContent)

      // Check for next page
      const links = headers.link
      hasNextPage = !!(links && links.includes('rel="next"'))
      if (hasNextPage) page++

      // Log progress
      logger.info("Processed PR files page", {
        page,
        filesInPage: filesWithContent.length,
        totalFiles: files.length,
        filesWithChanges: filesWithContent.filter(hasChanges).length,
      })

      // Optional: Add a small delay between pages to be extra careful with rate limits
      if (hasNextPage) {
        await new Promise((resolve) =>
          setTimeout(resolve, API_RATE_LIMIT.waitTime)
        )
      }
    }

    // Log summary of processed files
    const filesWithChanges = files.filter(hasChanges)
    logger.info("Completed processing PR files", {
      totalFiles: files.length,
      filesWithChanges: filesWithChanges.length,
      totalChunks: files.reduce(
        (sum, file) => sum + file.changes.chunks.length,
        0
      ),
    })

    return files
  } catch (error) {
    logger.error("Failed to fetch PR files", {
      error: error as Error,
      owner,
      repo,
      prNumber,
    })
    return []
  }
}

/**
 * Helper function to check if file has changes
 */
function hasChanges(file: PRFileChanges): boolean {
  return file.changes.lineNumbers.length > 0
}

/**
 * Helper function to get total changed lines
 */
function getChangedLinesCount(file: PRFileChanges): number {
  return file.changes.lineNumbers.length
}

/**
 * Create a pull request review with multiple comments using GraphQL
 */
export async function createPRReview(
  owner: string,
  repo: string,
  prId: string,
  commitId: string,
  comments: PullRequestReviewComment[]
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
  `

  try {
    const response = await octokit.graphql<AddPRReviewResponse>(mutation, {
      input: {
        pullRequestId: prId,
        commitOID: commitId,
        body: "Code Review Findings",
        comments,
        event: "COMMENT",
      },
    })

    logger.info("Created PR review with comments", {
      reviewId: response.addPullRequestReview.pullRequestReview.id,
      commentsCount:
        response.addPullRequestReview.pullRequestReview.comments.nodes.length,
    })

    return response
  } catch (error) {
    logger.error("Failed to create PR review", error as Error)
    throw error
  }
}

/**
 * Format an issue into a review comment with MDX
 */
export function formatIssueComment(issue: CodeIssue): string {
  const severityEmoji =
    {
      critical: "🚨",
      high: "⚠️",
      medium: "⚡",
      low: "ℹ️",
    }[issue.riskLevel.toLowerCase()] || "🔍"

  let comment = `_${severityEmoji} ${issue.title}_\n\n`

  // Main description
  comment += `**${issue.description}**\n\n`

  // Impact section
  if (issue.impact) {
    comment += `### Impact\n${issue.impact}\n\n`
  }

  // Reference section (if CWE or other references exist)
  if (issue.cweId || (issue.references?.standard && issue.references?.ruleId)) {
    comment += "### References\n"
    if (issue.cweId) {
      comment += `- [${issue.cweId}](https://cwe.mitre.org/data/definitions/${issue.cweId.replace("CWE-", "")}.html)\n`
    }
    if (issue.references?.standard && issue.references?.ruleId) {
      comment += `- ${issue.references.standard}: ${issue.references.ruleId}\n`
    }
    comment += "\n"
  }

  // Recommendation section with suggestion block
  if (issue?.recommendation?.description) {
    comment += `### Recommendation\n${issue.recommendation.description}\n\n`

    // Only add suggestion block if we have valid suggestion code
    if (issue.recommendation.code?.trim()) {
      comment += `
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
`
    }
  }

  comment += "\n<!-- This is an auto-generated comment by Evolua -->"

  return comment
}

/**
 * Queries pull request ID needed for review creation
 */
async function getPullRequestId(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          id
        }
      }
    }
  `

  try {
    const response = await octokit.graphql<GetPRIDResponse>(query, {
      owner,
      repo,
      number: prNumber,
    })

    return response.repository.pullRequest.id
  } catch (error) {
    logger.error("Failed to fetch PR ID", error as Error)
    throw error
  }
}

/**
 * Submit a complete review for multiple files
 */
export async function submitPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  commitId: string,
  results: Array<{
    file: PRFileChanges
    findings: {
      issues: CodeIssue[]
    }
  }>
) {
  try {
    // Use flatMap to transform and flatten in one operation
    const comments: PullRequestReviewComment[] = results
      .filter(({ file }) => hasChanges(file))
      .flatMap(({ file, findings }) =>
        findings.issues
          .filter((issue) =>
            file.changes.lineNumbers.includes(issue.location.lineStart)
          )
          .map((issue) => {
            const diffPosition = file.changes.lineToDiffPosition.get(
              issue.location.lineStart
            )

            if (diffPosition === undefined) {
              logger.warn("Missing diff position for line", {
                file: file.path,
                line: issue.location.lineStart,
              })
              return null
            }

            return {
              path: file.path,
              position: diffPosition,
              body: formatIssueComment(issue),
            }
          })
          .filter(
            (comment): comment is PullRequestReviewComment => comment !== null
          )
      )

    if (comments.length === 0) {
      logger.info("No valid issues found in changed lines")
      return
    }

    logger.info("Prepared PR review comments", {
      totalComments: comments.length,
      commentsByFile: comments.reduce(
        (acc, comment) => {
          acc[comment.path] = (acc[comment.path] || 0) + 1
          return acc
        },
        {} as Record<string, number>
      ),
    })

    const prId = await getPullRequestId(owner, repo, prNumber)
    await createPRReview(owner, repo, prId, commitId, comments)

    logger.info("Successfully submitted PR review", {
      totalComments: comments.length,
    })
  } catch (error) {
    logger.error("Failed to submit PR review", error as Error)
    throw error
  }
}

export function processAIResponse(rawResponse: AIResponse): AnalysisResults {
  return {
    summary: {
      totalIssues: rawResponse.summary.total_issues,
      riskLevels: {
        critical: rawResponse.summary.risk_levels.critical,
        high: rawResponse.summary.risk_levels.high,
        medium: rawResponse.summary.risk_levels.medium,
        low: rawResponse.summary.risk_levels.low,
      },
    },
    issues: rawResponse.issues.map((issue) => ({
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
        suggestion: issue.recommendation.suggestion,
      },
      cweId: issue.cwe_id,
      references: issue.references
        ? {
            standard: issue.references.standard,
            ruleId: issue.references.rule_id,
          }
        : undefined,
    })),
  }
}
