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

import Anthropic from "@anthropic-ai/sdk"
import { Message } from "@anthropic-ai/sdk/resources"
import { Logger } from "@aws-lambda-powertools/logger"
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics"
import { Tracer } from "@aws-lambda-powertools/tracer"
import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime"
import { Sema } from "async-sema"
import { commentOnPR, fetchPRFiles, init } from "./lib/github-helper"
import { AnalysisResult, AnalysisResults, PRFile } from "./types/scan-types"

/**
 * Initialize AWS Lambda Powertools for enhanced observability
 * These tools provide structured logging, metrics, and tracing capabilities
 */
const logger = new Logger({
  serviceName: "code-review-service",
  logLevel: "INFO",
})

const metrics = new Metrics({
  namespace: "CodeReview",
  serviceName: "code-review-service",
})

const tracer = new Tracer({
  serviceName: "code-review-service",
})

// Import middleware for AWS Systems Manager Parameter Store
const middy = require("@middy/core")
const ssm = require("@middy/ssm")

/**
 * Environment configuration and feature flags
 * SSM_STAGE_NAME: Deployment stage (dev/staging/prod)
 * BY_PASS_BEDROCK: Flag to use Anthropic directly instead of AWS Bedrock
 */
const {
  SSM_STAGE_NAME,
  BY_PASS_BEDROCK,
  ENVIRONMENT = "development",
} = process.env

/**
 * Configuration constants for the analysis process
 * Includes AI model parameters, rate limiting, and file handling settings
 */
const ANALYSIS_CONFIG = {
  maxTokens: {
    small: 1024, // For files < 1000 chars
    medium: 2048, // For files < 5000 chars
    large: 4096, // For larger files
  },
  temperature: 0.1, // Lower temperature for more consistent results
  concurrencyLimit: 5, // Maximum parallel file analyses
  maxFileSize: 100_000, // 100KB threshold for large file splitting
} as const

/**
 * AI model configuration
 * Currently using Claude 3 Sonnet for optimal performance/cost ratio
 */
const MODEL_ID = "claude-3-5-sonnet-20241022"
const byPassBedrock = BY_PASS_BEDROCK === "true"

/**
 * Initialize AI service clients
 * Supports both direct Anthropic API and AWS Bedrock
 */
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const bedrockClient = tracer.captureAWSClient(new BedrockRuntimeClient())

/**
 * System prompt that guides the AI's behavior
 * Focuses on specific areas of code review and sets clear expectations
 */
const SYSTEM_PROMPT = `You are a code review assistant focused on security, quality, and best practices. Analyze code for issues matching these criteria:
1. Security: vulnerabilities and weaknesses
2. Quality: maintainability and performance
3. Best Practices: standard patterns and guidelines

Keep responses concise and structured. Only report concrete, evidence-based issues.`

/**
 * Analysis prompt template defining the expected response format
 * Uses a structured JSON schema for consistent and parseable results
 */
const ANALYSIS_PROMPT = `Analyze the provided code for security vulnerabilities, code quality issues, and best practice violations.
Return findings in <findings> tags using this JSON schema:

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
      "id": string,
      "type": "vulnerability|code_quality|best_practice",
      "risk_level": "critical|high|medium|low",
      "title": string,
      "location": { "line_start": number, "line_end": number },
      "description": string,
      "impact": string,
      "recommendation": string,
      "cwe_id": string,
      "references": { "standard": string, "rule_id": string }
    }
  ]
}`

/**
 * Determines appropriate token limit based on content size
 * This helps optimize costs while ensuring adequate context for analysis
 *
 * @param content - The code content to analyze
 * @returns The appropriate token limit for the content size
 */
const getMaxTokens = (content: string): number => {
  const size = content.length
  if (size < 1000) return ANALYSIS_CONFIG.maxTokens.small
  if (size < 5000) return ANALYSIS_CONFIG.maxTokens.medium
  return ANALYSIS_CONFIG.maxTokens.large
}

/**
 * Utility function for implementing delay in retry logic
 * @param ms - Milliseconds to delay
 */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends code analysis request to the configured AI service
 * Handles different API formats for Anthropic direct vs AWS Bedrock
 *
 * @param content - The code content to analyze
 * @returns Promise containing the AI service response
 */
const sendMessage = async (
  content: string
): Promise<ConverseCommandOutput | Message> => {
  const maxTokens = getMaxTokens(content)
  const message = `${ANALYSIS_PROMPT}\n\n<source code>\n${content}\n</source code>`

  if (byPassBedrock) {
    // Direct Anthropic API call
    return await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: maxTokens,
      temperature: ANALYSIS_CONFIG.temperature,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    })
  } else {
    // AWS Bedrock API call
    return await bedrockClient.send(
      new ConverseCommand({
        modelId: MODEL_ID,
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
          temperature: ANALYSIS_CONFIG.temperature,
          maxTokens,
        },
      })
    )
  }
}

/**
 * Analyzes a single file for code issues
 * Includes performance monitoring and error handling
 *
 * @param file - The file to analyze
 * @returns Promise containing analysis results or null if no issues found
 */
const analyzeFile = async (
  file: PRFile & { content: string }
): Promise<AnalysisResults | null> => {
  const startTime = Date.now()
  try {
    // Handle large files by splitting them into manageable chunks
    if (file.content.length > ANALYSIS_CONFIG.maxFileSize) {
      return await analyzeLargeFile(file)
    }

    const normalizedContent = file.content.trim()
    const resp = (await sendMessage(normalizedContent)) as any
    const content = resp?.output?.message?.content || resp?.content

    // Parse and combine AI response content blocks
    const output = content?.map((msg: ContentBlock) => msg.text).join("\n\n")

    if (!output) {
      throw new Error("No output received!")
    }

    // Extract findings from the response
    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/
    const match = output.match(findingsRegex)

    if (!match?.[1]) {
      logger.info("No findings in the response.", { filePath: file.path })
      return null
    }

    // Parse and validate findings
    const findings = JSON.parse(match[1]) as AnalysisResults
    metrics.addMetric(
      "AnalysisTime",
      MetricUnit.Milliseconds,
      Date.now() - startTime
    )

    return findings
  } catch (error) {
    logger.error("Analysis failed", {
      filePath: file.path,
      error: error as Error,
      duration: Date.now() - startTime,
    })
    throw error
  }
}

/**
 * Handles analysis of large files by splitting them into manageable chunks
 * Aggregates results from multiple chunks while avoiding duplicates
 *
 * @param file - The large file to analyze
 * @returns Promise containing combined analysis results
 */
const analyzeLargeFile = async (
  file: PRFile & { content: string }
): Promise<AnalysisResults | null> => {
  /**
   * Splits a large file content into chunks of maximum 100,000 characters
   * Uses Regular Expression to divide the content:
   * /.{1,100000}/g breakdown:
   * - . matches any character
   * - {1,100000} matches between 1 and 100000 characters
   * - /g global flag to match all occurrences
   * - || [] provides empty array fallback if no matches found
   *
   * @example
   * Input: "This is a very long string..."
   * Output: ["First 100000 chars", "Next 100000 chars", ...]
   */

  const chunks = file.content.match(/.{1,100000}/g) || []
  const results = await Promise.all(
    chunks.map(async (chunk, index) => {
      return analyzeFile({
        ...file,
        content: chunk,
      })
    })
  )

  return aggregateResults(results.filter(Boolean) as AnalysisResults[])
}

/**
 * Combines multiple analysis results into a single result
 * Handles deduplication of issues and summation of metrics
 *
 * @param results - Array of analysis results to combine
 * @returns Combined and deduplicated analysis results
 */
const aggregateResults = (
  results: AnalysisResults[]
): AnalysisResults | null => {
  if (results.length === 0) return null
  if (results.length === 1) return results[0]

  return {
    summary: {
      total_issues: results.reduce((sum, r) => sum + r.summary.total_issues, 0),
      risk_levels: results.reduce(
        (acc, r) => ({
          critical: acc.critical + r.summary.risk_levels.critical,
          high: acc.high + r.summary.risk_levels.high,
          medium: acc.medium + r.summary.risk_levels.medium,
          low: acc.low + r.summary.risk_levels.low,
        }),
        { critical: 0, high: 0, medium: 0, low: 0 }
      ),
    },
    issues: results
      .flatMap((r) => r.issues)
      .filter(
        (issue, index, self) =>
          index === self.findIndex((i) => i.id === issue.id)
      ),
  }
}

/**
 * Processes multiple files concurrently with rate limiting
 * Uses async-sema for concurrency control
 *
 * @param files - Array of files to analyze
 * @returns Promise containing array of analysis results
 */
const processFiles = async (files: PRFile[]): Promise<AnalysisResult[]> => {
  // Initialize semaphore for concurrency control
  const sema = new Sema(ANALYSIS_CONFIG.concurrencyLimit, {
    capacity: files.length,
    pauseFn: () => logger.info("Rate limit reached, pausing..."),
    resumeFn: () => logger.info("Resuming analysis..."),
  })

  // Filter out files with null content
  const validFiles = files.filter(
    (file): file is PRFile & { content: string } => {
      if (!file.content) {
        logger.warn(`Skipping file ${file.path}: null content`)
        return false
      }
      return true
    }
  )

  // Process each file with semaphore control
  const analysisPromises = validFiles.map(async (file) => {
    await sema.acquire()
    try {
      const findings = await analyzeFile(file)
      if (findings && findings?.issues?.length > 0) {
        logger.info(`Found ${findings.issues.length} issues in ${file.path}`)
        return { file, findings }
      }
      return null
    } catch (error) {
      logger.error(`Error analyzing ${file.path}:`, error as Error)
      return null
    } finally {
      sema.release()
    }
  })

  const analysisResults = await Promise.all(analysisPromises)
  return analysisResults.filter(Boolean) as AnalysisResult[]
}

/**
 * Formats analysis results into a GitHub comment
 * Includes summary and detailed findings in markdown format
 *
 * @param file - The analyzed file
 * @param findings - Analysis results for the file
 * @returns Formatted markdown string for GitHub comment
 */
const formatComment = (file: PRFile, findings: AnalysisResults): string => {
  const issues = findings.issues
    .map((issue) => JSON.stringify(issue, null, 2))
    .map((json) => `\`\`\`json\n${json}\n\`\`\``)
    .join("\n\n")

  const summary = `### Code Review Summary
- Total Issues: ${findings.summary.total_issues}
- Critical: ${findings.summary.risk_levels.critical}
- High: ${findings.summary.risk_levels.high}
- Medium: ${findings.summary.risk_levels.medium}
- Low: ${findings.summary.risk_levels.low}`

  return `${file.path}: **${findings.issues.length} issues found**\n\n${summary}\n\n${issues}`
}

/**
 * Main Lambda handler function
 * Orchestrates the entire code review process
 *
 * @param event - Lambda event containing GitHub webhook payload
 * @param context - Lambda context
 * @returns Promise containing execution results
 */
const _handler = async (event: any, context: any) => {
  const startTime = Date.now()
  try {
    const detail = event.detail

    // Initialize observability tools with context
    logger.addContext(context)
    tracer.putAnnotation("service", "CodeReview")
    metrics.addMetadata("environment", ENVIRONMENT)

    // Initialize GitHub client with credentials
    const installationId = detail.data.installation.id
    const ghAppId = context.GITHUB_APP_ID
    const ghPrivateKey = context.GITHUB_PRIVATE_KEY
    await init(ghAppId, ghPrivateKey, installationId)

    // Fetch files from the pull request
    const prFileContent = await fetchPRFiles(
      detail.data.repository.owner.login,
      detail.data.repository.name,
      detail.data.pull_request.number
    )

    // Process files with concurrent analysis
    const results = await processFiles(prFileContent)

    // Post analysis results as PR comments
    await Promise.all(
      results.map(async ({ file, findings }) => {
        const comment = formatComment(file, findings)
        return await commentOnPR(detail.data.pull_request.node_id, comment)
      })
    )

    // Calculate final metrics
    const duration = Date.now() - startTime
    const totalIssues = results.reduce(
      (sum, { findings }) => sum + findings.issues.length,
      0
    )

    // Record execution metrics
    metrics.addMetric(
      "ProcessingTime",
      MetricUnit.Milliseconds,
      Date.now() - startTime
    )

    metrics.addMetric("FilesAnalyzed", MetricUnit.Count, prFileContent.length)

    metrics.addMetric("IssuesFound", MetricUnit.Count, totalIssues)

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
    }
  } catch (error) {
    // Log error details and record error metric
    logger.error("Handler execution failed", {
      error: error as Error,
      duration: Date.now() - startTime,
    })
    metrics.addMetric("HandlerErrors", MetricUnit.Count, 1)
    throw error
  }
}

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
}

/**
 * Export the handler with middleware
 * Adds SSM parameter fetching capability to the base handler
 */
export const handler = middy().use(ssm(ssmConfig)).handler(_handler)
