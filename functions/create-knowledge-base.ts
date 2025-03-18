import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createBedrockKnowledgeBase } from "./lib/bedrock-knowledge-base";
import { createNewKnowledgeBase } from "./lib/knowledge-bases";

const logger = new Logger({ serviceName: "create-knowledge-base" });
const tracer = new Tracer({ serviceName: "create-knowledge-base" });

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

interface CreateKnowledgeBaseRequest {
  name: string;
  description?: string;
}

/**
 * Lambda function to create a new knowledge base
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info("Received create knowledge base request", { event });

  try {
    // Validate the request
    const { tenantId, body } =
      await validateApiRequest<CreateKnowledgeBaseRequest>(event);

    if (!body.name) {
      return ErrorResponse(400, "Name is required");
    }

    if (body.name.length < 3 || body.name.length > 100) {
      return ErrorResponse(400, "Name must be between 3 and 100 characters");
    }

    if (body.description && body.description.length > 1000) {
      return ErrorResponse(400, "Description must be 1000 characters or less");
    }

    // Create the knowledge base
    const knowledgeBase = await createNewKnowledgeBase(
      tenantId,
      body.name,
      body.description || ""
    );

    // Create the Bedrock knowledge base asynchronously
    // In a production environment, this would typically be handled by a Step Function
    // or a separate Lambda function triggered by an event
    try {
      const bedrockKnowledgeBaseResult = await createBedrockKnowledgeBase(
        tenantId,
        body.name,
        body.description || ""
      );

      logger.info("Created Bedrock knowledge base", {
        bedrockKnowledgeBaseId:
          bedrockKnowledgeBaseResult.bedrockKnowledgeBaseId,
        status: bedrockKnowledgeBaseResult.status,
      });

      // Update the knowledge base with the Bedrock knowledge base ID
      // This would be handled by a separate function in a real implementation
      // updateKnowledgeBase(tenantId, knowledgeBase.knowledgeBaseId, {
      //   bedrockKnowledgeBaseId: bedrockKnowledgeBaseResult.bedrockKnowledgeBaseId,
      //   status: bedrockKnowledgeBaseResult.status
      // });
    } catch (err) {
      const error = err as Error;
      logger.error("Failed to create Bedrock knowledge base", {
        error: error.message,
      });
      // The knowledge base creation will continue, but the status will remain as CREATING
      // A background process would retry the Bedrock creation
    }

    return {
      statusCode: 201,
      body: JSON.stringify(knowledgeBase),
      headers: {
        "Content-Type": "application/json",
      },
    };
  } catch (err) {
    const error = err as any;
    logger.error("Error creating knowledge base", { error: error.message });

    return ErrorResponse(
      error.statusCode || 500,
      error.message || "Internal server error"
    );
  }
};
