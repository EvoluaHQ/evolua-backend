import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "error-handler" });

/**
 * Base class for custom application errors
 */
export class AppError extends Error {
  statusCode: number;
  errorType: string;
  details?: any;

  constructor(message: string, statusCode: number = 500, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorType = this.constructor.name;
    this.details = details;

    // Maintains proper stack trace for where error was thrown (only in V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error thrown when a resource is not found
 */
export class NotFoundError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 404, details);
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, details);
  }
}

/**
 * Error thrown when authorization fails
 */
export class AuthorizationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 403, details);
  }
}

/**
 * Error thrown when a dependent service is unavailable
 */
export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 503, details);
  }
}

/**
 * Error thrown when a request would exceed rate limits
 */
export class RateLimitError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 429, details);
  }
}

/**
 * Error thrown when a conflict occurs (e.g., resource already exists)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 409, details);
  }
}

/**
 * Handles errors uniformly across all Lambda functions
 *
 * @param error - The error to handle
 * @param context - Additional context for the error
 * @returns A formatted error response for API Gateway
 */
export function handleError(error: any, context?: any) {
  // Determine error details
  const isAppError = error instanceof AppError;
  const statusCode = isAppError ? error.statusCode : 500;
  const errorType = isAppError ? error.errorType : "InternalServerError";
  const message = error.message || "An unexpected error occurred";
  const details = isAppError ? error.details : undefined;

  // Log the error with context
  logger.error("Error occurred", {
    errorType,
    statusCode,
    message,
    details,
    context,
    stack: error.stack,
  });

  // Return a formatted response for API Gateway
  return {
    statusCode,
    body: JSON.stringify({
      error: {
        type: errorType,
        message,
        ...(details ? { details } : {}),
      },
    }),
    headers: {
      "Content-Type": "application/json",
    },
  };
}

/**
 * Validates that all required parameters exist and are of the correct type
 *
 * @param params - Object containing parameters to validate
 * @param schema - Schema defining the expected types and requirements
 * @throws ValidationError if validation fails
 */
export function validateParams(
  params: Record<string, any>,
  schema: Record<string, { required: boolean; type: string }>
) {
  const errors: string[] = [];

  for (const [key, validation] of Object.entries(schema)) {
    // Check if parameter exists
    if (
      validation.required &&
      (params[key] === undefined || params[key] === null)
    ) {
      errors.push(`Parameter '${key}' is required`);
      continue;
    }

    // Skip type checking if parameter is optional and not provided
    if (
      !validation.required &&
      (params[key] === undefined || params[key] === null)
    ) {
      continue;
    }

    // Check type
    const actualType = Array.isArray(params[key])
      ? "array"
      : typeof params[key];
    if (actualType !== validation.type) {
      errors.push(
        `Parameter '${key}' should be of type '${validation.type}', but got '${actualType}'`
      );
    }
  }

  if (errors.length > 0) {
    throw new ValidationError("Validation failed", { errors });
  }
}

/**
 * Creates a response object for successful API Gateway requests
 *
 * @param data - The data to return
 * @param statusCode - The HTTP status code (defaults to 200)
 * @returns A formatted success response for API Gateway
 */
export function successResponse(data: any, statusCode = 200) {
  return {
    statusCode,
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
    },
  };
}
