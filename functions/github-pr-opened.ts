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

import Anthropic from "@anthropic-ai/sdk";
import { Message } from "@anthropic-ai/sdk/resources";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { Sema } from "async-sema";
import { EventBridgeEvent } from "aws-lambda";
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
import { findUserByGithubHandle } from "./lib/users";
import {
  AIResponse,
  Findings,
  GitHubPROpenedEventDetail,
  PRFileChanges,
  ScanResult,
} from "./types";

/**
 * Initialize observability tools with consistent service naming
 */
const SERVICE_NAME = "code-review-service";
const ANTHROPIC_API_KEY =
  "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";

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
const {
  SSM_STAGE_NAME,
  BY_PASS_BEDROCK,
  ENVIRONMENT = "development",
} = process.env;

/**
 * Configuration constants for file processing and analysis
 * Size thresholds are based on:
 * - AI model token limits
 * - Processing efficiency
 * - Response quality considerations
 * - Cost optimization
 */
const ANALYSIS_CONFIG = {
  // File size thresholds in characters
  fileSize: {
    small: {
      maxSize: 10_000, // 10KB
      tokens: 2_048,
    },
    medium: {
      maxSize: 30_000, // 30KB
      tokens: 4_096,
    },
    large: {
      maxSize: 100_000, // 100KB
      tokens: 8_192,
    },
    max: 500_000, // 500KB
  },
  // Token allocation based on file size
  tokens: {
    maxContextTokens: 200_000, // Claude's max context window
    maxOutputTokens: 8_192, // Maximum response size
    reservedTokens: 1_000, // Reserved for prompts and overhead
    charsPerToken: 3.5, // Average characters per token for code
  },
  // AI model configuration
  model: {
    id: "claude-3-5-sonnet-20241022",
    temperature: 0.1, // Lower temperature for more consistent results
  },
  // Concurrency and processing
  concurrency: {
    limit: 5, // Maximum parallel processes
    retryLimit: 3, // Maximum retry attempts
    retryDelay: 1000, // Base delay between retries (ms)
  },
} as const;

// Initialize AI clients
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

const bedrockClient = tracer.captureAWSv3Client(new BedrockRuntimeClient());
const byPassBedrock = true; //BY_PASS_BEDROCK === "true"

/**
 * System prompt that guides the AI's behavior
 * Focuses on specific areas of code review and sets clear expectations
 */
const SYSTEM_PROMPT = `You are a code review assistant focused on security, quality, and best practices. Analyze code for issues matching these criteria:
1. Security: vulnerabilities and weaknesses
2. Quality: maintainability and performance
3. Best Practices: standard patterns and guidelines

Keep responses concise and structured. Only report concrete, evidence-based issues.`;

/**
 * Analysis prompt template defining the expected response format
 * Uses a structured JSON schema for consistent and parseable results
 */
const ANALYSIS_PROMPT = `Analyze the following source code for security vulnerabilities, code quality issues, and best practice violations.
The code contains changes in specific lines that need review. Each line is prefixed with its line number (e.g., "309|").

IMPORTANT: You must use the exact line numbers shown in the prefix when reporting issues in the location field.

Return findings in <findings> tags using this JSON format:

<JSON format>
{
  "summary": {
    "total_issues": number,
    "risk_levels": {
      "critical": number,
      "high": number,
      "medium": number,
      "low": number
    }
  },
  "issues": [
    {
      "id": string,             // e.g., "VULN-001", "QUAL-002"
      "type": "vulnerability|code_quality|best_practice",
      "risk_level": "critical|high|medium|low",
      "title": string,
      "location": { 
        "line_start": number,   // Use the exact line number from the prefix (e.g., 309)
        "line_end": number      // Use the exact line number from the prefix
      },
      "description": string,
      "impact": string,
      "recommendation": {
        "description": string,  // Step-by-step explanation of how to fix. Use MDX markdown for formatting for code snippets if needed.
        "code": string          // ONLY the exact code that should replace the original.
      },
      "cwe_id": string,           // e.g., "CWE-287"
      "references": {             // Optional: Industry standard references
        "standard": string,       // e.g., "OWASP", "CERT", "ISO-27001"
        "rule_id": string         // e.g., "A1:2021", "MSC21-C"
      }
    }
  ]
}
  </JSON format>`;

/**
 * Prepares code content with line numbers and change indicators for AI analysis
 * Adds line numbers as prefixes and marks changed lines with arrows
 *
 * @param content - The source code content
 * @param changedLines - Array of line numbers that were changed
 * @returns Formatted code string with line numbers and change indicators
 *
 * Example output:
 * 307|   }
 * 308| }
 * 309|→ while(true) {
 * 310|→   return 'hello'
 */
function prepareCodeWithLineNumbers(
  content: string,
  changedLines: number[]
): string {
  const lines = content.split("\n");
  return lines
    .map((line, index) => {
      const lineNumber = index + 1;
      const prefix = changedLines.includes(lineNumber) ? "→ " : "  ";
      return `${lineNumber.toString().padStart(4, " ")}|${prefix}${line}`;
    })
    .join("\n");
}

/**
 * Sends code analysis request to the configured AI service
 * Handles different API formats for Anthropic direct vs AWS Bedrock
 *
 * @param content - The code content to analyze
 * @returns Promise containing the AI service response
 */
const sendMessage = async (
  file: PRFileChanges & { content: string }
): Promise<ConverseCommandOutput | Message> => {
  // Get optimal token limit
  const tokenLimit = getTokenLimit(file.content);
  const codeWithLines = prepareCodeWithLineNumbers(
    file.content.trim(),
    file.changes.lineNumbers
  );

  const message = `${ANALYSIS_PROMPT}

The following code has changes in lines: ${file.changes.lineNumbers.join(", ")}.
Review these lines carefully for security issues, code quality problems, and best practice violations.

<source code>
${codeWithLines}
</source code>`;

  logger.info("Sending analysis request", {
    path: file.path,
    changedLines: file.changes.lineNumbers,
    messageSample: message,
  });

  if (byPassBedrock) {
    const response = await anthropic.messages.create({
      model: ANALYSIS_CONFIG.model.id,
      max_tokens: tokenLimit,
      temperature: ANALYSIS_CONFIG.model.temperature,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    });

    logger.info("Anthropic response received", {
      hasContent: !!response.content,
      contentLength: response.content?.length,
    });

    return response;
  } else {
    return await bedrockClient.send(
      new ConverseCommand({
        modelId: ANALYSIS_CONFIG.model.id,
        system: [
          {
            text: SYSTEM_PROMPT,
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                text: message,
              },
            ],
          },
        ],
        inferenceConfig: {
          temperature: ANALYSIS_CONFIG.model.temperature,
          maxTokens: tokenLimit,
        },
      })
    );
  }
};

while(true) {
  return 'hello';
}

const API_SECRET = '123';

/**
 * Determines appropriate token limit based on content size
 * This helps optimize costs while ensuring adequate context for analysis
 *
 * @param content - The code content to analyze
 * @returns The appropriate token limit for the content size
 */
const getTokenLimit = (content: string): number => {
  const size = content.length;

  // Quick return for small files using predefined tiers
  if (size <= ANALYSIS_CONFIG.fileSize.large.maxSize) {
    return ANALYSIS_CONFIG.fileSize.small.tokens;
  }
  if (size <= ANALYSIS_CONFIG.fileSize.medium.maxSize) {
    return ANALYSIS_CONFIG.fileSize.medium.tokens;
  }
  if (size <= ANALYSIS_CONFIG.fileSize.large.maxSize) {
    return ANALYSIS_CONFIG.fileSize.large.tokens;
  }

  // For larger files, calculate exact token need
  const estimatedTokens = Math.ceil(
    size / ANALYSIS_CONFIG.tokens.charsPerToken
  );
  const availableTokens =
    ANALYSIS_CONFIG.tokens.maxContextTokens -
    ANALYSIS_CONFIG.tokens.reservedTokens;

  return Math.min(
    estimatedTokens,
    availableTokens,
    ANALYSIS_CONFIG.tokens.maxOutputTokens
  );
};

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
    if (fileSize > ANALYSIS_CONFIG.fileSize.max) {
      logger.warn(`File too large to process`, {
        filePath: file.path,
        size: fileSize,
        maxAllowed: ANALYSIS_CONFIG.fileSize.max,
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
const processFiles = async (files: PRFileChanges[]): Promise<ScanResult[]> => {
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
  const sema = new Sema(ANALYSIS_CONFIG.concurrency.limit, {
    capacity: files.length,
    pauseFn: () => logger.info("Rate limit reached, pausing..."),
    resumeFn: () => logger.info("Resuming analysis..."),
  });

  // Filter out files with null content
  const validFiles = files.filter(
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

  logger.info("Files after filtering", {
    originalCount: files.length,
    validCount: validFiles.length,
    validFiles: validFiles.map((f) => ({
      path: f.path,
      changesCount: f.changes.lineNumbers.length,
    })),
  });

  logger.info("Before analysisPromises", {
    validFiles,
  });

  // Process each file with semaphore control
  const analysisPromises = validFiles.map(async (file) => {
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
    totalProcessed: validFiles.length,
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

    const user = await findUserByGithubHandle(detail.data.sender.login);
    if (!user) {
      await commentOnPR(
        detail.data.pull_request.node_id,
        `Hi @${detail.data.sender.login}, 

Thanks for submitting your PR! We've just scanned your code changes for potential 
issues in security, quality, and best practices. But it seems like you're not 
currently registered with Evolua.

Do you want to get detailed insights and ensuring your code meets high standards?
Join Evolua today and unlock a full report for your current and future PRs!

Go to https://evolua.io to learn more and sign up for your free account.`
      );

      return;
    }

    const initCommentId = await commentOnPR(
      detail.data.pull_request.node_id,
      "Analyzing code changes for issues around security, quality, and best practices"
    );

    const owner = detail.data.repository.owner.login;
    const repo = detail.data.repository.name;
    const pullNumber = detail.data.pull_request.number;
    const commitId = detail.data.pull_request.head.sha;

    // Fetch and analyze files
    const prFileContent = await fetchPRFiles(owner, repo, pullNumber);
    const results = await processFiles(prFileContent);

    await deleteCommentOnPR(initCommentId);

    // Submit review with all comments
    if (results.length > 0) {
      await submitPRReview(owner, repo, pullNumber, commitId, results);
    }

    // Calculate final metrics
    const duration = Date.now() - startTime;
    const totalIssues = results.reduce(
      (sum, { findings }) => sum + findings.issues.length,
      0
    );

    // Record execution metrics
    metrics.addMetric("ProcessingTime", MetricUnit.Milliseconds, duration);
    metrics.addMetric("FilesAnalyzed", MetricUnit.Count, prFileContent.length);
    metrics.addMetric("IssuesFound", MetricUnit.Count, totalIssues);

    logger.info("Analysis completed successfully", {
      filesAnalyzed: prFileContent.length,
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
          filesAnalyzed: prFileContent.length,
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

const API_SECRET_2 = '123';

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
