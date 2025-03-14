import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { ulid } from "ulid";
import {
  createKnowledgeBaseDocument,
  getKnowledgeBase,
} from "./lib/knowledge-bases";
import { KnowledgeBaseDocument } from "./types/knowledge-base";

const logger = new Logger({ serviceName: "upload-document-to-knowledge-base" });
const tracer = new Tracer({ serviceName: "upload-document-to-knowledge-base" });
const s3Client = new S3Client({});

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

interface UploadDocumentRequest {
  knowledgeBaseId: string;
  name: string;
  content: string;
  contentType: string;
  tags?: string[];
}

/**
 * Lambda function to upload a document to a knowledge base
 *
 * Note: This implementation is a skeleton. In a production environment,
 * you would need to:
 * 1. Install the @aws-sdk/client-s3 package
 * 2. Implement proper error handling for S3 operations
 * 3. Set up proper authentication and authorization
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info("Received upload document request", { event });

  try {
    // Validate the request
    const { tenantId, body } =
      await validateApiRequest<UploadDocumentRequest>(event);

    if (!body.knowledgeBaseId) {
      return ErrorResponse(400, "Knowledge base ID is required");
    }

    if (!body.name) {
      return ErrorResponse(400, "Document name is required");
    }

    if (!body.content) {
      return ErrorResponse(400, "Document content is required");
    }

    if (!body.contentType) {
      return ErrorResponse(400, "Content type is required");
    }

    // Check if knowledge base exists
    const knowledgeBase = await getKnowledgeBase(
      tenantId,
      body.knowledgeBaseId
    );

    if (!knowledgeBase) {
      return ErrorResponse(404, "Knowledge base not found");
    }

    const documentId = ulid();
    const s3Key = `${tenantId}/${body.knowledgeBaseId}/${documentId}`;

    // Upload the document to S3 - commented out until S3 client is available
    /*
    await s3Client.send(
      new PutObjectCommand({
        Bucket: KNOWLEDGE_BASE_BUCKET,
        Key: s3Key,
        Body: body.content,
        ContentType: body.contentType
      })
    );
    */

    // For now, log that we would upload to S3
    logger.info("Would upload to S3", {
      bucket: KNOWLEDGE_BASE_BUCKET,
      key: s3Key,
      contentType: body.contentType,
      contentSize: Buffer.from(body.content).length,
    });

    // Create the document record
    const document: KnowledgeBaseDocument = {
      tenantId,
      knowledgeBaseId: body.knowledgeBaseId,
      documentId,
      name: body.name,
      s3Key,
      contentType: body.contentType,
      tags: body.tags || [],
      size: Buffer.from(body.content).length,
      status: "PROCESSING", // Set to PROCESSING as the initial state
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await createKnowledgeBaseDocument(document);

    return {
      statusCode: 201,
      body: JSON.stringify({
        documentId,
        status: "PROCESSING",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (err) {
    const error = err as any;
    logger.error("Error uploading document", { error: error.message });

    return ErrorResponse(
      error.statusCode || 500,
      error.message || "Internal server error"
    );
  }
};
