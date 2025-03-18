import { Logger } from "@aws-lambda-powertools/logger";
import { ServiceUnavailableError } from "./errors";

const logger = new Logger({ serviceName: "aws-utils" });

/**
 * Default retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number; // in milliseconds
  maxDelay: number; // in milliseconds
  backoffFactor: number;
  retryableErrors: string[];
}

/**
 * Default retry configuration for AWS service calls
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffFactor: 2,
  retryableErrors: [
    "ThrottlingException",
    "TooManyRequestsException",
    "Throttling",
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
    "LimitExceededException",
    "ServiceUnavailable",
    "InternalServerError",
    "InternalFailure",
    "ServiceError",
  ],
};

/**
 * Executes a function with exponential backoff retry logic
 *
 * @param fn - The function to execute
 * @param config - Retry configuration
 * @param context - Additional context for logging
 * @returns The result of the function
 * @throws The last error encountered if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context: Record<string, any> = {}
): Promise<T> {
  let lastError: any;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Execute the function
      return await fn();
    } catch (error: any) {
      lastError = error;

      // Check if this error should be retried
      const errorName = error.name || error.code || "";
      const shouldRetry = config.retryableErrors.includes(errorName);

      // If this is the last attempt or the error is not retryable, throw
      if (attempt === config.maxRetries || !shouldRetry) {
        logger.error(
          "Operation failed after max retries or non-retryable error",
          {
            error,
            attempt,
            maxRetries: config.maxRetries,
            context,
            shouldRetry,
          }
        );
        throw error;
      }

      // Log retry attempt
      logger.warn("Operation failed, will retry", {
        errorName,
        errorMessage: error.message,
        attempt,
        nextAttemptDelay: delay,
        context,
      });

      // Wait before next attempt
      await sleep(delay);

      // Increase delay with backoff factor for next attempt
      delay = Math.min(delay * config.backoffFactor, config.maxDelay);
    }
  }

  // This should never happen due to the throw in the loop,
  // but TypeScript requires a return or throw at the end
  throw (
    lastError ||
    new ServiceUnavailableError("Operation failed after max retries")
  );
}

/**
 * Simple sleep function to pause execution
 *
 * @param ms - Time to sleep in milliseconds
 * @returns A promise that resolves after the given time
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an AWS SDK client method with retry logic
 *
 * @param client - The AWS SDK client
 * @param methodName - The method name to call
 * @param params - The parameters to pass to the method
 * @param config - Retry configuration
 * @param context - Additional context for logging
 * @returns The result of the method call
 */
export async function callWithRetry<T, P>(
  client: any,
  methodName: string,
  params: P,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context: Record<string, any> = {}
): Promise<T> {
  return withRetry(async () => client[methodName](params), config, {
    ...context,
    service: client.constructor.name,
    method: methodName,
  });
}

/**
 * Validates an AWS resource ARN format
 *
 * @param arn - The ARN string to validate
 * @param service - Optional service name to validate against
 * @returns true if the ARN is valid, false otherwise
 */
export function isValidArn(arn: string, service?: string): boolean {
  const arnPattern = /^arn:aws:([^:]*):([^:]*):([^:]*):([^:]*)(:.+)?$/;
  const match = arn.match(arnPattern);

  if (!match) {
    return false;
  }

  if (service && match[1] !== service) {
    return false;
  }

  return true;
}
