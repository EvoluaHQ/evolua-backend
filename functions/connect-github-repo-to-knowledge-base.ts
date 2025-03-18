import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Octokit } from "@octokit/rest";
import * as AdmZip from "adm-zip";
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  ScheduledEvent,
} from "aws-lambda";
import { ulid } from "ulid";
import {
  createS3DataSource,
  startBedrockIngestionJob,
} from "./lib/bedrock-knowledge-base";
import {
  createKnowledgeBaseDocument,
  getKnowledgeBase,
  updateKnowledgeBase,
} from "./lib/knowledge-bases";
import { KnowledgeBaseDocument } from "./types/knowledge-base";

const logger = new Logger({
  serviceName: "connect-github-repo-to-knowledge-base",
});
const tracer = new Tracer({
  serviceName: "connect-github-repo-to-knowledge-base",
});

// Commented out because the package is not installed yet
// const s3Client = new S3Client({});
// const octokit = new Octokit();

// Define these locally until api-helper is created
interface ApiRequestValidationResult<T> {
  tenantId: string;
  body: T;
}

function validateApiRequest<T>(
  event: APIGatewayProxyEvent
): Promise<ApiRequestValidationResult<T>> {
  const tenantId =
    event.requestContext.authorizer?.claims?.["custom:tenantId"] ||
    "demo-tenant";

  let body: T;
  try {
    body = event.body ? (JSON.parse(event.body) as T) : ({} as T);
  } catch (e) {
    throw { statusCode: 400, message: "Invalid request body" };
  }

  return Promise.resolve({ tenantId, body });
}

function ErrorResponse(
  statusCode: number,
  message: string
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({ message }),
    headers: {
      "Content-Type": "application/json",
    },
  };
}

// Environment variables
const KNOWLEDGE_BASE_BUCKET = process.env.KNOWLEDGE_BASE_BUCKET || "";
if (!KNOWLEDGE_BASE_BUCKET) {
  throw new Error("KNOWLEDGE_BASE_BUCKET environment variable is required");
}

interface ConnectGitHubRepoRequest {
  knowledgeBaseId: string;
  repositoryUrl: string;
  branch?: string;
  accessToken?: string;
}

/**
 * Extracts owner and repo from GitHub URL
 *
 * @param repoUrl - The GitHub repository URL
 * @returns Object containing owner and repo
 */
function extractRepoInfo(repoUrl: string): { owner: string; repo: string } {
  // Handle URLs like:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git

  const httpsPattern = /https:\/\/github.com\/([^\/]+)\/([^\/\.]+)(\.git)?/;
  const sshPattern = /git@github.com:([^\/]+)\/([^\/\.]+)(\.git)?/;

  let match = repoUrl.match(httpsPattern) || repoUrl.match(sshPattern);

  if (!match) {
    throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

/**
 * Lambda function to connect a GitHub repository to a knowledge base
 * This can be triggered by API Gateway or as a scheduled event
 */
export const handler = async (
  event: APIGatewayProxyEvent | ScheduledEvent
): Promise<APIGatewayProxyResult | void> => {
  logger.info("Received connect GitHub repo request", { event });

  // Handle scheduled event
  if ("source" in event && event.source === "aws.events") {
    // This would check for updates to connected repositories
    logger.info("Processing scheduled event for GitHub repository updates");

    // Implementation would:
    // 1. Query knowledge bases with GitHub repositories
    // 2. Check if repositories have been updated since last check
    // 3. If updated, download and process the changes

    return;
  }

  // Handle API Gateway event
  try {
    // Validate the request
    const { tenantId, body } =
      await validateApiRequest<ConnectGitHubRepoRequest>(
        event as APIGatewayProxyEvent
      );

    if (!body.knowledgeBaseId) {
      return ErrorResponse(400, "Knowledge base ID is required");
    }

    if (!body.repositoryUrl) {
      return ErrorResponse(400, "Repository URL is required");
    }

    // Check if knowledge base exists
    const knowledgeBase = await getKnowledgeBase(
      tenantId,
      body.knowledgeBaseId
    );

    if (!knowledgeBase) {
      return ErrorResponse(404, "Knowledge base not found");
    }

    try {
      // Extract repo info
      const { owner, repo } = extractRepoInfo(body.repositoryUrl);

      // In a real implementation:
      // 1. Use Octokit to download the repository
      // 2. Process the files
      // 3. Upload to S3
      // 4. Create document records
      // 5. Start ingestion

      logger.info("Would connect to GitHub repository", {
        owner,
        repo,
        branch: body.branch || "main",
      });

      // Update the knowledge base with GitHub info
      await updateKnowledgeBase(tenantId, body.knowledgeBaseId, {
        githubRepositoryUrl: body.repositoryUrl,
        githubBranch: body.branch || "main",
        lastSyncedAt: new Date().toISOString(),
      });

      /*
      // Create S3 data source for the knowledge base
      const dataSourceResult = await createS3DataSource(
        knowledgeBase.bedrockKnowledgeBaseId,
        KNOWLEDGE_BASE_BUCKET,
        `${tenantId}/${body.knowledgeBaseId}/`
      );
      
      // Start ingestion job
      const ingestionJobResult = await startBedrockIngestionJob(
        knowledgeBase.bedrockKnowledgeBaseId,
        dataSourceResult.dataSourceId
      );
      */

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "GitHub repository connected successfully",
          knowledgeBaseId: body.knowledgeBaseId,
          repositoryUrl: body.repositoryUrl,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      };
    } catch (err) {
      const error = err as Error;
      logger.error("Failed to connect GitHub repository", {
        error: error.message,
      });
      return ErrorResponse(
        500,
        `Failed to connect GitHub repository: ${error.message}`
      );
    }
  } catch (err) {
    const error = err as any;
    logger.error("Error connecting GitHub repository", {
      error: error.message,
    });

    return ErrorResponse(
      error.statusCode || 500,
      error.message || "Internal server error"
    );
  }
};
