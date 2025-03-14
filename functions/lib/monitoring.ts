import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnits } from "@aws-lambda-powertools/metrics";
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import { callWithRetry } from "./aws-utils";

const logger = new Logger({ serviceName: "monitoring" });
const metrics = new Metrics({ namespace: "Evolua/KnowledgeBase" });
const cloudWatchClient = new CloudWatchClient({});

const SERVICE_NAME = process.env.SERVICE_NAME || "evolua-backend";
const ENVIRONMENT = process.env.ENVIRONMENT || "dev";

/**
 * Records metrics for knowledge base operations
 *
 * @param tenantId - The tenant ID
 * @param operation - The operation being measured
 * @param status - Success or failure
 * @param durationMs - Operation duration in milliseconds
 * @param metadata - Additional dimensions and metadata
 */
export function recordKnowledgeBaseMetric(
  tenantId: string,
  operation: string,
  status: "success" | "failure",
  durationMs: number,
  metadata: Record<string, string> = {}
): void {
  try {
    // Add default dimensions
    metrics.addDimension("Service", SERVICE_NAME);
    metrics.addDimension("Environment", ENVIRONMENT);
    metrics.addDimension("TenantId", tenantId);
    metrics.addDimension("Operation", operation);
    metrics.addDimension("Status", status);

    // Add custom dimensions from metadata
    Object.entries(metadata).forEach(([key, value]) => {
      if (typeof value === "string") {
        metrics.addDimension(key, value);
      }
    });

    // Record metrics
    metrics.addMetric("OperationCount", MetricUnits.Count, 1);
    metrics.addMetric(
      "OperationDuration",
      MetricUnits.Milliseconds,
      durationMs
    );

    // Publish metrics
    metrics.publishStoredMetrics();
  } catch (error) {
    logger.warn("Failed to record metrics", {
      error,
      tenantId,
      operation,
      status,
    });
  }
}

/**
 * Records a custom metric to CloudWatch
 *
 * @param metricName - Name of the metric
 * @param value - Value of the metric
 * @param unit - Unit of the metric
 * @param dimensions - Dimensions to associate with the metric
 */
export async function publishCustomMetric(
  metricName: string,
  value: number,
  unit: MetricUnits,
  dimensions: Record<string, string> = {}
): Promise<void> {
  try {
    // Convert dimensions to CloudWatch format
    const dimensionsArray = Object.entries(dimensions).map(([name, value]) => ({
      Name: name,
      Value: value,
    }));

    // Add default dimensions
    dimensionsArray.push({ Name: "Service", Value: SERVICE_NAME });
    dimensionsArray.push({ Name: "Environment", Value: ENVIRONMENT });

    const command = new PutMetricDataCommand({
      Namespace: "Evolua/KnowledgeBase",
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Dimensions: dimensionsArray,
          Timestamp: new Date(),
        },
      ],
    });

    await callWithRetry(cloudWatchClient, "send", command, undefined, {
      metricName,
      value,
      unit,
    });
  } catch (error) {
    logger.warn("Failed to publish custom metric", {
      error,
      metricName,
      value,
    });
  }
}

/**
 * Tracks performance of an async operation and records metrics
 *
 * @param tenantId - The tenant ID
 * @param operation - Name of the operation
 * @param fn - Async function to execute and measure
 * @param metadata - Additional metadata to record
 * @returns Result of the function execution
 */
export async function trackPerformance<T>(
  tenantId: string,
  operation: string,
  fn: () => Promise<T>,
  metadata: Record<string, string> = {}
): Promise<T> {
  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    // Record success metric
    recordKnowledgeBaseMetric(
      tenantId,
      operation,
      "success",
      duration,
      metadata
    );

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    // Record failure metric
    recordKnowledgeBaseMetric(
      tenantId,
      operation,
      "failure",
      duration,
      metadata
    );

    throw error;
  }
}

/**
 * Reports document processing statistics
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentCount - Number of documents processed
 * @param totalSize - Total size of documents in bytes
 */
export async function reportDocumentProcessing(
  tenantId: string,
  knowledgeBaseId: string,
  documentCount: number,
  totalSize: number
): Promise<void> {
  try {
    await publishCustomMetric(
      "ProcessedDocuments",
      documentCount,
      MetricUnits.Count,
      {
        TenantId: tenantId,
        KnowledgeBaseId: knowledgeBaseId,
      }
    );

    await publishCustomMetric(
      "ProcessedDocumentSize",
      totalSize,
      MetricUnits.Bytes,
      {
        TenantId: tenantId,
        KnowledgeBaseId: knowledgeBaseId,
      }
    );
  } catch (error) {
    logger.warn("Failed to report document processing", {
      error,
      tenantId,
      knowledgeBaseId,
      documentCount,
      totalSize,
    });
  }
}
