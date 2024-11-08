/**
 * Code Review Lambda Function
 *
 * This Lambda function performs automated code reviews on GitHub pull requests
 * using AI services (AWS Bedrock or Anthropic Claude). It analyzes code for
 * security issues, quality problems, and best practice violations.
 *
 * Features:
 * - Concurrent file processing with rate limiting
 * - Large file handling
 * - Comprehensive error handling and monitoring
 * - Support for multiple AI providers
 */

import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { Sema } from "async-sema";
import { EventBridgeEvent } from "aws-lambda";
import {
  AI_ANALYSIS_CONFIG,
  getScanLimitMessage,
  getStartReviewMessage,
  getSubscriptionLimitMessage,
  getUnregisteredUserMessage,
  sendMessage,
} from "./lib/ai";
import { SUBSCRIPTION_TIERS } from "./lib/constants";
import { shouldSkipFile } from "./lib/file-ignore";
import {
  commentOnPR,
  deleteCommentOnPR,
  fetchPRFiles,
  init,
  processAIResponse,
  submitPRReview,
} from "./lib/github-helper";
import { PullRequest, saveScanResults } from "./lib/scans";
import { findUserByGithubHandle, incrementScanCount, Tier } from "./lib/users";
import {
  AIResponse,
  Findings,
  GitHubPROpenedEventDetail,
  PRFileChanges,
  ScanResult,
} from "./types";
import { MaxScansExceededError } from "./types/errors";

/**
 * Initialize observability tools with consistent service naming
 */
const SERVICE_NAME = "github-pr-opened";

/**
 * Initialize AWS Lambda Powertools for enhanced observability
 * These tools provide structured logging, metrics, and tracing capabilities
 */
const logger = new Logger({
  serviceName: SERVICE_NAME,
  logLevel: "INFO",
});

const metrics = new Metrics({
  namespace: "CodeReview",
  serviceName: SERVICE_NAME,
});

const tracer = new Tracer({
  serviceName: SERVICE_NAME,
});

// Import middleware for AWS Systems Manager Parameter Store
const middy = require("@middy/core");
const ssm = require("@middy/ssm");

/**
 * Environment configuration and feature flags
 * SSM_STAGE_NAME: Deployment stage (dev/staging/prod)
 * BY_PASS_BEDROCK: Flag to use Anthropic directly instead of AWS Bedrock
 */
const { SSM_STAGE_NAME, ENVIRONMENT = "development" } = process.env;

/**
 * Analyzes a single file for code issues
 * Includes performance monitoring and error handling
 * Handles size-based processing decisions and error tracking
 *
 * @param file - The file to analyze
 * @returns Promise containing analysis results or null if no issues found
 */
const analyzeFile = async (
  file: PRFileChanges & { content: string }
): Promise<Findings | null> => {
  const startTime = Date.now();
  const fileSize = file.content.length;

  try {
    logger.info("Starting file analysis", {
      path: file.path,
      size: fileSize,
      changedLines: file.changes.lineNumbers,
      chunksCount: file.changes.chunks.length,
    });

    // Skip extremely large files
    if (fileSize > AI_ANALYSIS_CONFIG.fileSize.max) {
      logger.warn(`File too large to process`, {
        filePath: file.path,
        size: fileSize,
        maxAllowed: AI_ANALYSIS_CONFIG.fileSize.max,
      });
      metrics.addMetric("SkippedFiles", MetricUnit.Count, 1);
      return null;
    }

    const resp = (await sendMessage(file)) as any;
    const content = resp?.output?.message?.content || resp?.content;

    // Log raw AI response
    logger.info("AI service response", {
      path: file.path,
      hasContent: !!content,
      contentLength: content?.length,
      rawResponse: JSON.stringify(resp).substring(0, 500), // First 500 chars for debugging
    });

    // Parse and combine AI response content blocks
    const output = content?.map((msg: ContentBlock) => msg.text).join("\n\n");

    if (!output) {
      throw new Error("No output received from AI service");
    }

    logger.info("Processing AI output", {
      path: file.path,
      outputLength: output.length,
      outputPreview: output.substring(0, 200),
    });

    // Extract content between <findings> tags
    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/;
    const match = output.match(findingsRegex);

    if (!match?.[1]) {
      logger.info("No findings in the response.", {
        filePath: file.path,
        outputLength: output.length,
        hasFindings: false,
      });
      return null;
    }

    // Parse and validate findings
    const aiFindings: AIResponse = JSON.parse(match[1]) as AIResponse;
    const findings: Findings = processAIResponse(aiFindings);

    logger.info("Before filtering", {
      path: file.path,
      changedLines: file.changes.lineNumbers,
      allIssues: findings.issues.map((issue) => ({
        id: issue.id,
        line: issue.location.lineStart,
        title: issue.title,
        isInChangedLines: file.changes.lineNumbers.includes(
          issue.location.lineStart
        ),
      })),
    });

    // Filter findings to only include changed lines with detailed logging
    const filteredIssues = findings.issues.filter((issue) => {
      const isIncluded = file.changes.lineNumbers.includes(
        issue.location.lineStart
      );
      logger.info("Filtering issue", {
        issueLine: issue.location.lineStart,
        changedLines: file.changes.lineNumbers,
        included: isIncluded,
        issueTitle: issue.title,
      });
      return isIncluded;
    });

    logger.info("After filtering", {
      path: file.path,
      originalIssuesCount: findings.issues.length,
      filteredIssuesCount: filteredIssues.length,
      filteredIssues: filteredIssues.map((issue) => ({
        id: issue.id,
        line: issue.location.lineStart,
        title: issue.title,
      })),
    });

    // Update findings with filtered issues
    findings.issues = filteredIssues;

    // Update summary counts
    findings.summary.totalIssues = findings.issues.length;
    findings.summary.riskLevels = findings.issues.reduce(
      (acc, issue) => {
        acc[issue.riskLevel.toLowerCase() as keyof typeof acc]++;
        return acc;
      },
      { critical: 0, high: 0, medium: 0, low: 0 }
    );

    // Record metrics
    metrics.addMetric(
      "AnalysisTime",
      MetricUnit.Milliseconds,
      Date.now() - startTime
    );
    metrics.addMetric("ProcessedFileSize", MetricUnit.Bytes, fileSize);

    return findings.issues.length > 0 ? findings : null;
  } catch (error) {
    logger.error("Analysis failed", {
      filePath: file.path,
      size: fileSize,
      error: error as Error,
      duration: Date.now() - startTime,
    });

    metrics.addMetric("AnalysisErrors", MetricUnit.Count, 1);
    throw error;
  }
};

/**
 * Processes multiple files concurrently with rate limiting
 * Uses async-sema for concurrency control
 *
 * @param files - Array of files to analyze
 * @returns Promise containing array of analysis results
 */
const processFiles = async (
  files: (PRFileChanges & { content: string })[]
): Promise<ScanResult[]> => {
  logger.info("Starting processFiles", {
    totalFiles: files.length,
    filesDetails: files.map((f) => ({
      path: f.path,
      hasContent: !!f.content,
      changesCount: f.changes.lineNumbers.length,
      shouldSkip: shouldSkipFile(f.path),
    })),
  });

  // Initialize semaphore for concurrency control
  const sema = new Sema(AI_ANALYSIS_CONFIG.concurrency.limit, {
    capacity: files.length,
    pauseFn: () => logger.info("Rate limit reached, pausing..."),
    resumeFn: () => logger.info("Resuming analysis..."),
  });

  // Process each file with semaphore control
  const analysisPromises = files.map(async (file) => {
    await sema.acquire();
    try {
      const findings = await analyzeFile(file);

      logger.info("File analysis result", {
        path: file.path,
        hasFindings: !!findings,
        issuesCount: findings?.issues?.length ?? 0,
      });

      if (findings && findings?.issues.length > 0) {
        logger.info(
          `Found ${findings.issues.length} issues in changed lines of ${file.path}`
        );
        return { file, findings };
      }
      return null;
    } catch (error) {
      logger.error(`Error analyzing ${file.path}:`, error as Error);
      return null;
    } finally {
      sema.release();
    }
  });

  const analysisResults = await Promise.all(analysisPromises);
  const filteredResults = analysisResults.filter(Boolean) as ScanResult[];

  logger.info("Analysis results summary", {
    totalProcessed: files.length,
    resultsFound: filteredResults.length,
    resultDetails: filteredResults.map((r) => ({
      path: r.file.path,
      issuesCount: r.findings.issues.length,
    })),
  });

  return filteredResults;
};

type Event = EventBridgeEvent<"pull_request.opened", GitHubPROpenedEventDetail>;

/**
 * Main Lambda handler function
 * Orchestrates the entire code review process
 *
 * @param event - Lambda event containing GitHub webhook payload
 * @param context - Lambda context
 * @returns Promise containing execution results
 */
const _handler = async (event: Event, context: any) => {
  const startTime = Date.now();
  try {
    const detail = event.detail;

    // Initialize observability tools
    logger.addContext(context);
    tracer.putAnnotation("service", SERVICE_NAME);
    metrics.addMetadata("environment", ENVIRONMENT);

    // Initialize GitHub client
    const installationId = detail.data.installation.id;
    const ghAppId = context.GITHUB_APP_ID;
    const ghPrivateKey = context.GITHUB_PRIVATE_KEY;
    await init(ghAppId, ghPrivateKey, installationId);

    const username = detail.data.sender.login;
    const user = await findUserByGithubHandle(username);
    if (!user) {
      await commentOnPR(
        detail.data.pull_request.node_id,
        getUnregisteredUserMessage(username)
      );

      return;
    }

    const subscriptionLimits =
      user.tier === Tier.FREE
        ? SUBSCRIPTION_TIERS.FREE
        : SUBSCRIPTION_TIERS.PRO;

    try {
      await incrementScanCount(user.id, subscriptionLimits.maxScans);
    } catch (error) {
      if (error instanceof MaxScansExceededError) {
        // User reached their scan limit
        await commentOnPR(
          detail.data.pull_request.node_id,
          getScanLimitMessage(username)
        );

        return;
      } else {
        logger.error("Unable to comment on PR", error as Error);
        throw error;
      }
    }

    const initCommentId = await commentOnPR(
      detail.data.pull_request.node_id,
      getStartReviewMessage(username)
    );

    const owner = detail.data.repository.owner.login;
    const repo = detail.data.repository.name;
    const pullNumber = detail.data.pull_request.number;

    // Fetch and analyze files
    const prFileContent = await fetchPRFiles(owner, repo, pullNumber);

    // Filter out files with null content
    const validFiles = prFileContent.filter(
      (file): file is PRFileChanges & { content: string } => {
        // Check if file content is null
        if (!file.content) {
          logger.warn(`Skipping file ${file.path}: null content`);
          metrics.addMetric("SkippedFiles", MetricUnit.Count, 1);
          return false;
        }

        // Check if file should be skipped based on filters
        if (shouldSkipFile(file.path)) {
          logger.info(`Skipping excluded file: ${file.path}`);
          metrics.addMetric("ExcludedFiles", MetricUnit.Count, 1);
          return false;
        }

        // Check if file has any changes
        if (file.changes.lineNumbers.length === 0) {
          logger.info(`Skipping file with no changes: ${file.path}`);
          return false;
        }

        return true;
      }
    );

    logger.debug(
      "Filtered out invalid files (e.g. null content, excluded file types, etc.)",
      {
        filesCount: validFiles.length,
      }
    );

    const maxFilesPerScan = subscriptionLimits.filesPerScan;
    // only process the first maxFilesPerScan files
    const filesToAnalyze = validFiles.slice(0, maxFilesPerScan);

    // Notify users if they reach the max file per tier to scan
    if (filesToAnalyze.length > validFiles.length) {
      const maxFilesMessage = getSubscriptionLimitMessage(
        username,
        maxFilesPerScan
      );

      await commentOnPR(detail.data.pull_request.node_id, maxFilesMessage);
    }

    const results = await processFiles(filesToAnalyze);

    await deleteCommentOnPR(initCommentId);

    // Submit review with all comments
    if (results.length > 0) {
      await submitPRReview(owner, repo, pullNumber, results);
    }

    // Calculate final metrics
    const duration = Date.now() - startTime;
    const totalIssues = results.reduce(
      (sum, { findings }) => sum + findings.issues.length,
      0
    );

    // Record execution metrics
    metrics.addMetric("ProcessingTime", MetricUnit.Milliseconds, duration);
    metrics.addMetric("FilesAnalyzed", MetricUnit.Count, filesToAnalyze.length);
    metrics.addMetric("IssuesFound", MetricUnit.Count, totalIssues);

    logger.info("Analysis completed successfully", {
      filesAnalyzed: filesToAnalyze.length,
      issuesFound: totalIssues,
      duration,
    });

    const repoId = `github#${detail.data.repository.id}`;
    const pr: PullRequest = {
      id: detail.data.pull_request.id.toString(),
      number: detail.data.pull_request.number,
      url: detail.data.pull_request.url,
      title: detail.data.pull_request.title,
      createdAt: detail.data.pull_request.created_at,
    };
    await saveScanResults(repoId, pr, results);

    // Return success response with metrics
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "PR review completed",
        metrics: {
          filesAnalyzed: filesToAnalyze.length,
          issuesFound: totalIssues,
          processingTimeMs: duration,
        },
      }),
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Log error details and record error metric
    logger.error("Handler execution failed", {
      error: error as Error,
      duration,
    });

    metrics.addMetric("HandlerErrors", MetricUnit.Count, 1);
    metrics.addMetric("ProcessingTime", MetricUnit.Milliseconds, duration);

    throw error;
  }
};

/**
 * Middleware configuration for AWS Systems Manager Parameter Store
 * Automatically fetches and caches GitHub credentials
 */
const ssmConfig = {
  cache: true,
  cacheExpiry: 5 * 60 * 1000, // Cache credentials for 5 minutes
  setToContext: true,
  fetchData: {
    GITHUB_APP_ID: `/evolua/${SSM_STAGE_NAME}/github/app-id`,
    GITHUB_PRIVATE_KEY: `/evolua/${SSM_STAGE_NAME}/github/private-key`,
  },
};

/**
 * Export the handler with middleware
 * Adds SSM parameter fetching capability to the base handler
 */
export const handler = middy().use(ssm(ssmConfig)).handler(_handler);
