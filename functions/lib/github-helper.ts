import { Logger } from "@aws-lambda-powertools/logger"
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/core"
import {
  AddCommentResponse,
  AddPRReviewResponse,
  CodeIssue,
  FetchPRFileContentResponse,
  FetchPRFilesResponse,
  GetPRIDResponse,
  PRFile,
} from "../types/github"

const logger = new Logger()

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

  logger.debug("GitHub Octokit initialized")
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

export async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRFile[]> {
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
  `

  try {
    const files: PRFile[] = []
    let hasNextPage = true
    let cursor: string | null = null
    let sha: string

    while (hasNextPage) {
      const response: FetchPRFilesResponse =
        await octokit.graphql<FetchPRFilesResponse>(query, {
          owner,
          repo,
          prNumber,
          cursor,
        })

      sha = response.repository.pullRequest.headRef.target.oid
      const prFiles = response.repository.pullRequest.files

      // Add files from current page to our collection
      const fetchContentPromises = prFiles.nodes.map(async (file) => {
        const content = await fetchPRFileContent(owner, repo, file.path, sha)
        return {
          ...file,
          content,
          sha,
        }
      })

      const newFiles = await Promise.all(fetchContentPromises)
      files.push(...newFiles)

      // Update pagination info
      hasNextPage = prFiles.pageInfo.hasNextPage
      cursor = prFiles.pageInfo.endCursor
    }

    return files
  } catch (error) {
    logger.error("Failed to fetch PR files", error as Error)
    return []
  }
}

/**
 * Create a pull request review with multiple comments using GraphQL
 */
export async function createPRReview(
  owner: string,
  repo: string,
  prId: string,
  commitId: string,
  comments: Array<{
    path: string
    line: number
    body: string
  }>
) {
  const mutation = `
    mutation($input: AddPullRequestReviewInput!) {
      addPullRequestReview(input: $input) {
        pullRequestReview {
          id
          comments {
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
        comments: comments.map((comment) => ({
          path: comment.path,
          position: comment.line,
          body: comment.body,
        })),
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
    }[issue.risk_level.toLowerCase()] || "🔍"

  let comment = `_${severityEmoji} ${issue.title}_\n\n`

  // Main description
  comment += `**${issue.description}**\n\n`

  // Impact section
  if (issue.impact) {
    comment += `### Impact\n${issue.impact}\n\n`
  }

  // Reference section (if CWE or other references exist)
  if (
    issue.cwe_id ||
    (issue.references?.standard && issue.references?.rule_id)
  ) {
    comment += "### References\n"
    if (issue.cwe_id) {
      comment += `- [${issue.cwe_id}](https://cwe.mitre.org/data/definitions/${issue.cwe_id.replace("CWE-", "")}.html)\n`
    }
    if (issue.references?.standard && issue.references?.rule_id) {
      comment += `- ${issue.references.standard}: ${issue.references.rule_id}\n`
    }
    comment += "\n"
  }

  // Recommendation section with suggestion block
  if (issue.recommendation) {
    comment += `### Recommendation\n${issue.recommendation}\n\n`
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
${issue.recommendation}
\`\`\`

</details>
<!-- suggestion_end -->
`
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
    file: { path: string }
    findings: {
      issues: CodeIssue[]
    }
  }>
) {
  try {
    // Prepare all comments
    const comments = results.flatMap(({ file, findings }) =>
      findings.issues.map((issue) => ({
        path: file.path,
        line: issue.location.line_start,
        body: formatIssueComment(issue),
      }))
    )

    // Get PR ID
    const prId = await getPullRequestId(owner, repo, prNumber)

    // Create review with all comments
    await createPRReview(owner, repo, prId, commitId, comments)

    logger.info("Successfully submitted PR review", {
      filesWithIssues: results.length,
      totalComments: comments.length,
    })
  } catch (error) {
    logger.error("Failed to submit PR review", error as Error)
    throw error
  }
}
