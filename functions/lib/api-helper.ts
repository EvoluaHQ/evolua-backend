import { Logger } from "@aws-lambda-powertools/logger";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  handleError,
  successResponse,
  validateParams,
  ValidationError,
} from "./errors";

const logger = new Logger({ serviceName: "api-helper" });

/**
 * Result of API request validation
 */
export interface ApiRequestValidationResult<T> {
  tenantId: string;
  body: T;
  requestId: string;
}

/**
 * Validates an API Gateway request and extracts the relevant information
 *
 * @param event - The API Gateway event
 * @param schema - Optional schema for validation
 * @returns The validated request data
 * @throws ValidationError if validation fails
 */
export async function validateApiRequest<T>(
  event: APIGatewayProxyEvent,
  schema?: Record<string, { required: boolean; type: string }>
): Promise<ApiRequestValidationResult<T>> {
  logger.debug("Validating API request", { event });

  // Extract tenant ID from claims
  const tenantId = event.requestContext.authorizer?.claims?.["custom:tenantId"];
  if (!tenantId) {
    throw new ValidationError("Missing tenant ID in request", {
      path: "requestContext.authorizer.claims['custom:tenantId']",
    });
  }

  // Extract request ID for tracing
  const requestId = event.requestContext.requestId || "unknown";

  // Parse and validate body
  let body: T;
  try {
    body = event.body ? (JSON.parse(event.body) as T) : ({} as T);
  } catch (error) {
    throw new ValidationError("Invalid JSON in request body");
  }

  // Validate against schema if provided
  if (schema && Object.keys(schema).length > 0) {
    validateParams(body as Record<string, any>, schema);
  }

  return { tenantId, body, requestId };
}

/**
 * Creates a standardized error response for API Gateway
 *
 * @param statusCode - The HTTP status code
 * @param message - The error message
 * @param details - Optional error details
 * @returns A formatted error response for API Gateway
 */
export function ErrorResponse(
  statusCode: number,
  message: string,
  details?: any
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({
      error: {
        message,
        ...(details ? { details } : {}),
      },
    }),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
    },
  };
}

/**
 * Creates a standardized success response for API Gateway
 *
 * @param data - The data to return
 * @param statusCode - The HTTP status code (defaults to 200)
 * @returns A formatted success response
 */
export function SuccessResponse(
  data: any,
  statusCode = 200
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
    },
  };
}

/**
 * Higher-order function for wrapping Lambda handlers with standard error handling
 *
 * @param handler - The Lambda handler function
 * @returns A wrapped handler with error handling
 */
export function withErrorHandling(
  handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>
) {
  return async (
    event: APIGatewayProxyEvent
  ): Promise<APIGatewayProxyResult> => {
    try {
      return await handler(event);
    } catch (error) {
      return handleError(error, { event });
    }
  };
}

/**
 * Validates and extracts query parameters
 *
 * @param event - The API Gateway event
 * @param schema - Schema for validation
 * @returns The validated query parameters
 * @throws ValidationError if validation fails
 */
export function validateQueryParams(
  event: APIGatewayProxyEvent,
  schema: Record<string, { required: boolean; type: string }>
): Record<string, any> {
  const queryParams = event.queryStringParameters || {};
  validateParams(queryParams, schema);
  return queryParams;
}

/**
 * Validates and extracts path parameters
 *
 * @param event - The API Gateway event
 * @param schema - Schema for validation
 * @returns The validated path parameters
 * @throws ValidationError if validation fails
 */
export function validatePathParams(
  event: APIGatewayProxyEvent,
  schema: Record<string, { required: boolean; type: string }>
): Record<string, any> {
  const pathParams = event.pathParameters || {};
  validateParams(pathParams, schema);
  return pathParams;
}
