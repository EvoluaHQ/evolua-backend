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
import { Octokit } from "@octokit/rest";
import { Sema } from "async-sema";
import { EventBridgeEvent } from "aws-lambda";
import { ulid } from "ulid";
import {
  AI_ANALYSIS_CONFIG,
  getNoMatchingOrgMessage,
  getPRClosedMessage,
  getScanLimitMessage,
  getStartReviewMessage,
  getSubscriptionLimitMessage,
  getUnregisteredUserMessage,
  initAnthropic,
  sendMessage,
} from "./lib/ai";
import {
  loadConfigFromGitHub,
  shouldSkipFileBasedOnConfig,
} from "./lib/config";
import { SUBSCRIPTION_TIERS } from "./lib/constants";
import { publishEvent } from "./lib/events";
import { shouldSkipFile } from "./lib/file-ignore";
import {
  commentOnPR,
  deleteCommentOnPR,
  fetchPRDetails,
  fetchPRFiles,
  init,
  processAIResponse,
  submitPRReview,
} from "./lib/github-helper";
import {
  findOrganizationMembershipsByClerkUserId,
  getOrganizationsByIds,
} from "./lib/organizations";
import { findTenantReposByRepoId, updateLastReviewedAt } from "./lib/repos";
import { PullRequest, saveScanResults } from "./lib/scans";
import { findUserByGithubHandle, incrementScanCount, User } from "./lib/users";
import {
  AIResponse,
  EventEnvelope,
  Findings,
  PRFileChanges,
  ScanCompletedEventDetail,
  ScanGitHubPrInput,
  ScanResult,
  SubscriptionTierLimits,
} from "./types";
import { MaxScansExceededError } from "./types/errors";

const { SSM_STAGE_NAME, STAGE_NAME, SERVICE_NAME } = process.env;

const logger = new Logger();
const tracer = new Tracer();
const metrics = new Metrics({
  namespace: "CodeReview",
});

type Event = EventBridgeEvent<
  "scan_triggered",
  EventEnvelope<ScanGitHubPrInput>
>;

const _handler = async (event: Event, context: any) => {
  const input = event.detail.data;
  logger.debug("Scanning GitHub PR", { input });

  initAnthropic(context.ANTHROPIC_API_KEY);

  const startTime = new Date();

  try {
    // Initialize observability tools
    logger.addContext(context);
    tracer.putAnnotation("service", SERVICE_NAME || "PullRequest Service");
    metrics.addMetadata("environment", STAGE_NAME || "dev");

    // Initialize GitHub client
    const installationId = input.installation_id;
    const ghAppId = context.GITHUB_APP_ID;
    const ghPrivateKey = context.GITHUB_PRIVATE_KEY;
    const octokit: Octokit = await init(ghAppId, ghPrivateKey, installationId);

    logger.debug("Fetching PR details from GitHub");

    const ghPrData = await fetchPRDetails(
      input.repository.owner_login,
      input.repository.name,
      input.pull_request_number
    );
    if (ghPrData.state === "closed") {
      await commentOnPR(
        ghPrData.node_id,
        getPRClosedMessage(input.sender_login)
      );

      logger.info("PR is closed, skipped...", {
        repoName: input.repository.name,
        prNumber: input.pull_request_number,
      });

      return;
    }

    const pullRequest = {
      id: ghPrData.id,
      number: input.pull_request_number,
      node_id: ghPrData.node_id,
      title: ghPrData.title,
      url: ghPrData.url,
      created_at: ghPrData.created_at,
    };

    const username = input.sender_login;
    const user = await findUserByGithubHandle(username);
    if (!user) {
      await commentOnPR(
        pullRequest.node_id,
        getUnregisteredUserMessage(username)
      );

      logger.info("User not found in database, skipped...", { username });

      return;
    }

    const repoId = `github#${input.repository.id}`;
    const shouldScanPR = await shouldWeScanPR(repoId, user);

    if (shouldScanPR === "MaxScansExceeded") {
      await commentOnPR(pullRequest.node_id, getScanLimitMessage(username));
      return;
    } else if (shouldScanPR === "NoMatchingOrg") {
      await commentOnPR(pullRequest.node_id, getNoMatchingOrgMessage(username));
      return;
    }

    const subscriptionLimits: SubscriptionTierLimits = shouldScanPR;

    const initCommentId = await commentOnPR(
      pullRequest.node_id,
      getStartReviewMessage(username)
    );

    const owner = input.repository.owner_login;
    const repo = input.repository.name;
    const pullNumber = pullRequest.number;

    // Fetch and analyze files
    const prFileContent = await fetchPRFiles(owner, repo, pullNumber);

    // Get the HEAD SHA for the PR
    const headSha = ghPrData.head.sha;

    // Enhance the files with repository information for configuration loading
    const enhancedFiles = prFileContent.map((file) => ({
      ...file,
      repository: {
        owner_login: owner,
        name: repo,
      },
      headSha,
      octokit,
    }));

    // Filter out files with null content
    const validFiles = enhancedFiles.filter(
      (
        file
      ): file is PRFileChanges & {
        content: string;
        repository: { owner_login: string; name: string };
        headSha: string;
        octokit: any;
      } => {
        return (
          file.content !== null &&
          file.changeType !== "DELETED" &&
          file.changes.lineNumbers.length > 0 &&
          !shouldSkipFile(file.path)
        );
      }
    );

    logger.info(
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

      await commentOnPR(pullRequest.node_id, maxFilesMessage);
    }

    const results = await processFiles(filesToAnalyze);

    await deleteCommentOnPR(initCommentId);

    // Submit review with all comments
    if (results.length > 0) {
      await submitPRReview(owner, repo, pullNumber, results);
    } else {
      logger.info("No issues found, skipping review submission");

      await commentOnPR(pullRequest.node_id, "No issues found, good job! 👍");
    }

    // Calculate final metrics
    const duration = Date.now() - startTime.getTime();
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

    const pr: PullRequest = {
      id: pullRequest.id.toString(),
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      createdAt: pullRequest.created_at,
    };

    const scanSummary = await saveScanResults(repoId, pr, startTime, results);
    await updateLastReviewedAt(repoId, startTime);

    const scanCompletedEvent: ScanCompletedEventDetail = {
      repoId,
      scanId: scanSummary.scanId,
      reviewedAt: startTime.toJSON(),
      pullRequest: pr,
      summary: scanSummary,
      reviewedFiles: filesToAnalyze.map((file) => file.path),
    };
    await publishEvent(
      ulid(),
      "scan-github-pr-handler",
      "scan_completed",
      scanCompletedEvent
    );
  } catch (error) {
    const duration = Date.now() - startTime.getTime();

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
 * Analyzes a single file for code issues
 * Includes performance monitoring and error handling
 * Handles size-based processing decisions and error tracking
 *
 * @param file - The file to analyze
 * @returns Promise containing analysis results or null if no issues found
 */
const analyzeFile = async (
  file: PRFileChanges & {
    content: string;
    repository: { owner_login: string; name: string };
    headSha: string;
    octokit: Octokit;
  }
): Promise<Findings | null> => {
  const startTime = Date.now();
  const fileSize = file.content?.length || 0;

  try {
    logger.info("Analyzing file", {
      path: file.path,
      size: fileSize,
      changedLines: file.changes.lineNumbers,
      chunksCount: file.changes.chunks.length,
    });

    // Load the configuration from the repository
    const config = await loadConfigFromGitHub(
      file.octokit,
      file.repository.owner_login,
      file.repository.name,
      file.headSha
    );

    // Check if the file should be skipped based on configuration
    if (shouldSkipFileBasedOnConfig(config, file.path)) {
      logger.info("Skipping file based on evolua.yml configuration", {
        path: file.path,
      });
      return null;
    }

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

    const output = await sendMessage(file, config);

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
        lineStart: issue.location.lineStart,
        lineEnd: issue.location.lineEnd,
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
        lineStart: issue.location.lineStart,
        lineEnd: issue.location.lineEnd,
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
        lineStart: issue.location.lineStart,
        lineEnd: issue.location.lineEnd,
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
  files: (PRFileChanges & {
    content: string;
    repository: { owner_login: string; name: string };
    headSha: string;
    octokit: any;
  })[]
): Promise<ScanResult[]> => {
  logger.info("Starting processFiles", {
    count: files.length,
  });

  const sema = new Sema(AI_ANALYSIS_CONFIG.concurrency.limit);
  const processingStartTime = Date.now();

  // Process files and attempt retries if needed
  const results = await Promise.all(
    files.map(async (file) => {
      const fileStartTime = Date.now();
      await sema.acquire();
      try {
        const findings = await analyzeFile(file);

        logger.info("File analysis result", {
          path: file.path,
          hasFindings: !!findings,
          issuesCount: findings?.issues.length || 0,
        });

        metrics.addMetric("AnalyzedFiles", MetricUnit.Count, 1);
        metrics.addMetric(
          "ProcessingTime",
          MetricUnit.Milliseconds,
          Date.now() - fileStartTime
        );

        return findings
          ? {
              file,
              findings,
            }
          : null;
      } catch (error) {
        logger.error(`Error analyzing ${file.path}:`, error as Error);
        return null;
      } finally {
        sema.release();
      }
    })
  );

  // Log overall processing time
  logger.info("Completed processing all files", {
    duration: Date.now() - processingStartTime,
    filesCount: files.length,
  });

  const filteredResults = results.filter(Boolean) as ScanResult[];

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

const middy = require("@middy/core");
const ssm = require("@middy/ssm");

/**
 * Export the handler with middleware
 * Adds SSM parameter fetching capability to the base handler
 */
export const handler = middy(_handler).use(
  ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // Cache credentials for 5 minutes
    setToContext: true,
    fetchData: {
      GITHUB_APP_ID: `/evolua/${SSM_STAGE_NAME}/github/app-id`,
      GITHUB_PRIVATE_KEY: `/evolua/${SSM_STAGE_NAME}/github/private-key`,
      ANTHROPIC_API_KEY: `/evolua/${SSM_STAGE_NAME}/anthropic/api-key`,
    },
  })
);

type NoScanReason = "NoMatchingOrg" | "MaxScansExceeded";
type ShouldScanPR = NoScanReason | SubscriptionTierLimits;

async function shouldWeScanPR(
  repoId: string,
  user: User
): Promise<ShouldScanPR> {
  const tenantRepos = await findTenantReposByRepoId(repoId);
  const tenantIds = tenantRepos.map((x) => x.tenantId);

  const shouldScanBasedOnOrg = await (async () => {
    const organizationMemberships =
      await findOrganizationMembershipsByClerkUserId(user.clerkUserId);
    const orgIds = organizationMemberships.map((x) => x.orgId);
    const matchingOrgIds = tenantIds.filter((x) => orgIds.includes(x));
    if (matchingOrgIds.length === 0) {
      logger.info(
        "User doesn't belong to any matching organization for this repo.",
        {
          repoId,
          repoOwnerIds: tenantIds,
          userId: user.id,
          userOrgIds: orgIds,
        }
      );
      return false;
    }

    const matchingOrgs = await getOrganizationsByIds(matchingOrgIds);
    const activeOrg = matchingOrgs.find((x) => x.status === "active");
    if (!activeOrg) {
      logger.info("None of the matching organizations for repo is active.", {
        repoId,
        repoOwnerIds: tenantIds,
        userId: user.id,
        userOrgIds: orgIds,
      });
      return false;
    }

    return true;
  })();

  const shouldScanBasedOnPersonal = (() => {
    const matchingPersonal = tenantIds.includes(user.id);
    if (!matchingPersonal) {
      logger.info("User doesn't own the repo.", {
        repoId,
        repoOwnerIds: tenantIds,
        userId: user.id,
      });
      return false;
    }

    return true;
  })();

  if (!shouldScanBasedOnOrg && !shouldScanBasedOnPersonal) {
    return "NoMatchingOrg";
  } else if (shouldScanBasedOnOrg) {
    return SUBSCRIPTION_TIERS.PRO;
  } else {
    const subscriptionLimits =
      user.tier === "FREE" ? SUBSCRIPTION_TIERS.FREE : SUBSCRIPTION_TIERS.PRO;

    try {
      await incrementScanCount(user.id, subscriptionLimits.maxScans);
    } catch (error) {
      logger.warn("Scan increment error", {
        error,
        userId: user.id,
      });

      if (error instanceof MaxScansExceededError) {
        logger.info("Max scans exceeded", {
          userId: user.id,
          subscriptionTier: user.tier,
          maxScans: subscriptionLimits.maxScans,
        });

        return "MaxScansExceeded";
      }
    }

    return subscriptionLimits;
  }
}
