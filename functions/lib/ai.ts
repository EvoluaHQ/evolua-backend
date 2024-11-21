import Anthropic from "@anthropic-ai/sdk";
import { Message } from "@anthropic-ai/sdk/resources";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import { PRFileChanges } from "../types";
import { SITE_URL } from "./constants";

// service name comes from the "POWERTOOLS_SERVICE_NAME" environment variable
const logger = new Logger();
const tracer = new Tracer();

/**
 * Configuration constants for file processing and analysis
 * Size thresholds are based on:
 * - AI model token limits
 * - Processing efficiency
 * - Response quality considerations
 * - Cost optimization
 */
export const AI_ANALYSIS_CONFIG = {
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

const bedrockClient = tracer.captureAWSv3Client(new BedrockRuntimeClient());
const byPassBedrock = true; //BY_PASS_BEDROCK === "true"

let anthropic: Anthropic;
export const initAnthropic = (apiKey: string) => {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey,
    });
  }
};

/**
 * Analysis prompt template defining the expected response format
 * Uses a structured JSON schema for consistent and parseable results
 * Focuses on specific areas of code review and sets clear expectations
 */
export const SCAN_SYSTEM_PROMPT = `You are an expert code reviewer specialized in security vulnerabilities, code quality, and best practices. 

Analysis Areas:
1. Security: Identify vulnerabilities, data exposure, and unsafe operations
2. Code Quality: Evaluate performance, maintainability, and error handling
3. Best Practices: Assess adherence to design patterns and coding standards

Guidelines:
- Use the full source code for context but ONLY report issues found in the changed lines marked with arrows (→)
- Use exact line numbers from the prefix
- Provide actionable recommendations with code examples
- Reference relevant standards (CWE, OWASP, Documentations)
- Keep responses concise and structured. Only report concrete, evidence-based issues.
- Never include opinions, style preferences, or speculative issues.
- Assign risk levels based on severity:
  * Critical: Direct security risks (RCE, credentials exposure, etc)
  * High: Significant vulnerabilities (XSS, unsafe operations, etc)
  * Medium: Important quality issues (performance, validation, error handling, etc)
  * Low: Minor improvements (style, documentation, optimizations)

Always return findings in this exact JSON format within <findings> tags:
{
  "summary": {
    "total_issues": number,   // Count of all identified issues
    "risk_levels": {
      "critical": number,     // Count per severity
      "high": number,
      "medium": number,
      "low": number
    }
  },
  "issues": [
    {
      "id": string,             // e.g., "VULN-001", "SEC-001", "QUAL-002"
      "type": "vulnerability" | "code_quality" | "best_practice",
      "risk_level": "critical" | "high" | "medium" | "low",
      "title": string,          // Clear, specific issue title
      "location": { 
        "line_start": number,   // Must use the exact line number from the prefix (e.g., 309)
        "line_end": number      // Must use the exact line number from the prefix
      },
      "description": string,    // Clear explanation of the issue
      "impact": string,
      "recommendation": {
        "description": string, // Use MDX markdown for code snippets if needed.
        "code": string         // Complete replacement code only
      },
      "cwe_id": string | null,        // e.g., "CWE-287".
      "references": {
        "name": string | null,    // Reference to help users understand the issue (e.g., "OWASP", "CERT", "ISO-27001", "ESLint")
        "url": string | null      // Official documentation links, etc
      }
    }
  ]
}`;

/**
 * Sends code analysis request to the configured AI service
 * Handles different API formats for Anthropic direct vs AWS Bedrock
 *
 * @param content - The code content to analyze
 * @returns Promise containing the AI service response
 */
export const sendMessage = async (
  file: PRFileChanges & { content: string }
): Promise<ConverseCommandOutput | Message> => {
  // Get optimal token limit
  const tokenLimit = getTokenLimit(file.content);
  const codeWithLines = prepareCodeWithLineNumbers(
    file.content.trim(),
    file.changes.lineNumbers
  );

  const USER_PROMPT = `Review the following code changes for security issues, quality problems, and best practice violations.
  
  Changed lines: ${file.changes.lineNumbers.join(", ")}
  
  <source code>
  ${codeWithLines}
  </source code>`;

  try {
    if (byPassBedrock) {
      const response = await anthropic.messages.create({
        model: AI_ANALYSIS_CONFIG.model.id,
        max_tokens: tokenLimit,
        temperature: AI_ANALYSIS_CONFIG.model.temperature,
        system: SCAN_SYSTEM_PROMPT,
        messages: [{ role: "user", content: USER_PROMPT }],
      });

      logger.info("Anthropic response received", {
        hasContent: !!response.content,
        contentLength: response.content?.length,
      });

      return response;
    } else {
      return await bedrockClient.send(
        new ConverseCommand({
          modelId: AI_ANALYSIS_CONFIG.model.id,
          system: [
            {
              text: SCAN_SYSTEM_PROMPT,
            },
          ],
          messages: [
            {
              role: "user",
              content: [
                {
                  text: USER_PROMPT,
                },
              ],
            },
          ],
          inferenceConfig: {
            temperature: AI_ANALYSIS_CONFIG.model.temperature,
            maxTokens: tokenLimit,
          },
        })
      );
    }
  } catch (error) {
    logger.error("AI API call failed", { error, file: file.path });
    throw error;
  }
};

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
  if (size <= AI_ANALYSIS_CONFIG.fileSize.small.maxSize) {
    return AI_ANALYSIS_CONFIG.fileSize.small.tokens;
  }
  if (size <= AI_ANALYSIS_CONFIG.fileSize.medium.maxSize) {
    return AI_ANALYSIS_CONFIG.fileSize.medium.tokens;
  }
  if (size <= AI_ANALYSIS_CONFIG.fileSize.large.maxSize) {
    return AI_ANALYSIS_CONFIG.fileSize.large.tokens;
  }

  // For larger files, calculate exact token need
  const estimatedTokens = Math.ceil(
    size / AI_ANALYSIS_CONFIG.tokens.charsPerToken
  );
  const availableTokens =
    AI_ANALYSIS_CONFIG.tokens.maxContextTokens -
    AI_ANALYSIS_CONFIG.tokens.reservedTokens;

  return Math.min(
    estimatedTokens,
    availableTokens,
    AI_ANALYSIS_CONFIG.tokens.maxOutputTokens
  );
};

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
 * Shown when there are more files to analyse than the allowed
 * @param username
 * @param maxFiles
 * @returns
 */
export const getSubscriptionLimitMessage = (
  username: string,
  maxFiles: number
) => `### Hello @${username}! 🚀

Great PR! I've analyzed your first ${maxFiles} files, but there's more we could review! ✨

**Want full PR coverage?** 💪
Visit https://evolua.io to unlock more features and level up your code reviews!`;

/**
 * Shown when users hit the scan limit
 * @param username
 * @returns
 */
export const getScanLimitMessage = (
  username: string
) => `### Hi @${username}! 👋

Thanks for submitting your PR! I noticed you've reached your monthly scan limit. 

We love helping you maintain high-quality code with security and best practices insights! ✨

🚀 **Ready for unlimited scans?**
Visit ${SITE_URL} to upgrade your account and keep the code reviews coming!`;

/**
 * Shown when user doesn't have an account
 * @param username
 * @returns
 */
export const getUnregisteredUserMessage = (
  username: string
) => `### Welcome @${username}! 🎉

Great PR! I've analyzed your code changes for:
- 🔒 Security vulnerabilities
- ✨ Code quality improvements
- 🎯 Best practices alignment

**Ready to see the full review?** 
Head over to ${SITE_URL} to:
- Create your free account
- Get detailed insights
- Unlock automated PR reviews
- Ensure high-quality code

Let's make your code even better together! 🚀`;

/**
 * Shown when users submit a new PR
 * @param username
 * @returns
 */
export const getStartReviewMessage = (username: string) =>
  `Hey @${username}, I got this, I'll review it now, give me a sec. 🚀`;

/**
 * Shown when a PR is closed
 * @param username
 * @returns
 */
export const getPRClosedMessage = (username: string) =>
  `Hey @${username}, please reopen this PR if you want me to review it.`;
