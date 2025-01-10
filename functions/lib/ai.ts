import Anthropic from "@anthropic-ai/sdk";
import { TextBlock } from "@anthropic-ai/sdk/resources";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { FileChanges, PRFileChanges } from "../types";
import { SITE_URL } from "./constants";
import { getLanguageExtension } from "./utils";

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
      tokens: 8_192,
    },
    medium: {
      maxSize: 30_000, // 30KB
      tokens: 8_192,
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
    temperature: 0.1, // Lower temperature for more consistent results
    bedrock: {
      sonnet35v2: "us.anthropic.claude-3-5-sonnet-20241022-v2:0", // cross-region inference
      sonnet35v1: "us.anthropic.claude-3-5-sonnet-20240620-v1:0", // cross-region inference
      sonnet3: "us.anthropic.claude-3-sonnet-20240229-v1:0", // cross-region inference
      haiku35: "us.anthropic.claude-3-5-haiku-20241022-v1:0", // cross-region inference
      haiku3: "us.anthropic.claude-3-haiku-20240307-v1:0", // cross-region inference
    },
    anthropic: {
      sonnet35v2: "claude-3-5-sonnet-20241022",
    },
  },
  // Concurrency and processing
  concurrency: {
    limit: 10, // Maximum parallel processes
    retryLimit: 3, // Maximum retry attempts
    retryDelay: 1000, // Base delay between retries (ms)
  },
} as const;

const bedrockClient = tracer.captureAWSv3Client(new BedrockRuntimeClient());

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
- Lines marked with ⊢ indicate the start of a change hunk, and ⊣ indicates the end of a hunk
- When reporting multi-line issues, ensure start_line and end_line are within the same hunk (between ⊢ and ⊣ markers)
- Do not create issues that span across different hunks - each issue must be contained within a single hunk
- Provide actionable recommendations with code examples
- Reference relevant standards (CWE, OWASP, Documentations)
- Keep responses concise and structured. Only report concrete, evidence-based issues.
- Never include opinions, style preferences, or speculative issues.
- Recommendation code must include all necessary context, imports, and surrounding code to be fully functional.
- Assign risk levels based on severity:
  * Critical: Direct security risks (RCE, credentials exposure, etc)
  * High: Significant vulnerabilities (XSS, unsafe operations, etc)
  * Medium: Important quality issues (performance, validation, error handling, etc)
  * Low: Minor improvements (style, documentation, optimizations)

Always return findings in this exact JSON format within <findings> tags, ensuring all strings use proper JSON escaping:
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
        "line_start": number,   // Must use the exact line number from the prefix (e.g., 309), must be within the same hunk
        "line_end": number      // Must use the exact line number from the prefix, must be within the same hunk and >= line_start
      },
      "description": string,    // Clear explanation of the issue
      "impact": string,
      "recommendation": {
        "description": string, // Provide step-by-step guidance how to fix the issue. When relevant, briefly mention alternative approaches
        "code": string         // Provide complete, production-ready code replacement. Add brief comments explaining key changes. Use proper JSON string escaping (\\n for newlines, \\" for quotes, \\\\ for backslashes, \\b, \\f, \\r, \\t for control characters). DO NOT use triple quotes.
      },
      "cwe_id": string | null,        // e.g., "CWE-287".
      "reference": {
        "name": string | null,    // Reference to help users understand the issue (e.g., "OWASP", "CERT", "ISO-27001", "ESLint")
        "url": string | null      // Official documentation links, etc
      }
    }
  ]
}`;

const useBedrock = async (
  modelId: string,
  userPrompt: string,
  tokenLimit: number
): Promise<string[]> => {
  logger.info("Using Bedrock for analysis", { modelId, tokenLimit });

  const resp = await bedrockClient.send(
    new ConverseCommand({
      modelId: modelId,
      system: [{ text: SCAN_SYSTEM_PROMPT }],
      messages: [
        {
          role: "user",
          content: [{ text: userPrompt }],
        },
      ],
      inferenceConfig: {
        temperature: AI_ANALYSIS_CONFIG.model.temperature,
        maxTokens: tokenLimit,
      },
    })
  );

  const contentBlocks = resp.output?.message?.content || [];
  return contentBlocks.map((msg) => msg.text || "");
};

const runAnthropic = async (
  modelId: string,
  userPrompt: string,
  tokenLimit: number
): Promise<string[]> => {
  logger.info("Using Anthropic for analysis", { modelId, tokenLimit });

  const resp = await anthropic.messages.create({
    model: modelId,
    max_tokens: tokenLimit,
    temperature: AI_ANALYSIS_CONFIG.model.temperature,
    system: SCAN_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  logger.info("Anthropic response received", {
    hasContent: !!resp.content,
    contentLength: resp.content?.length,
  });

  return resp.content?.map((msg) => (msg as TextBlock).text) ?? [];
};

type runAiScanFunc = (
  userPrompt: string,
  tokenLimit: number
) => Promise<string[]>;

const analyzeWithFallbacks = async (
  userPrompt: string,
  tokenLimit: number
): Promise<string | undefined> => {
  const aiModels = AI_ANALYSIS_CONFIG.model;
  const modelsToRun: runAiScanFunc[] = [
    (up, tl) => useBedrock(aiModels.bedrock.sonnet35v2, up, tl),
    (up, tl) => runAnthropic(aiModels.anthropic.sonnet35v2, up, tl),
    (up, tl) => useBedrock(aiModels.bedrock.sonnet35v1, up, tl),
    (up, tl) => useBedrock(aiModels.bedrock.sonnet3, up, tl),
    (up, tl) => useBedrock(aiModels.bedrock.haiku35, up, tl),
    (up, tl) => useBedrock(aiModels.bedrock.haiku3, up, tl),
  ];

  for (const runAiScan of modelsToRun) {
    try {
      const contentBlocks = await runAiScan(userPrompt, tokenLimit);
      return contentBlocks.join("\n\n");
    } catch (error) {
      logger.warn("AI API call failed, trying the next model", { error });
    }
  }

  logger.error("All AI models failed to return a response");

  return undefined;
};

/**
 * Sends code analysis request to the configured AI service
 * Handles different API formats for Anthropic direct vs AWS Bedrock
 *
 * @param content - The code content to analyze
 * @returns Promise containing the AI service response
 */
export const sendMessage = async (
  file: PRFileChanges & { content: string }
): Promise<string | undefined> => {
  // Get optimal token limit
  const tokenLimit = getTokenLimit(file.content);

  const codeWithLines = prepareCodeWithLineNumbersAndHunks(
    file.content.trim(),
    file.changes
  );

  const USER_PROMPT = `Review the following code changes for security issues, quality problems, and best practice violations.
  
  File path: ${file.path}
  File type: ${getLanguageExtension(file.path)}
  Changed lines: ${file.changes.lineNumbers.join(", ")}
  
  <source code>
  ${codeWithLines}
  </source code>`;

  return await analyzeWithFallbacks(USER_PROMPT, tokenLimit);
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
 * Prepares source code for AI analysis by adding line numbers, hunk boundaries, and change indicators.
 *
 * @param content - The source code content to be formatted
 * @param changes - File changes information containing chunks and changed lines
 * @returns Formatted string with line numbers and visual indicators
 *
 * The output format includes:
 * - 4-digit line numbers padded with spaces
 * - Vertical bar separator
 * - Hunk boundary markers:
 *   ⊢ Start of hunk
 *   ⊣ End of hunk
 *   ┃ Middle of hunk
 *   (space) Outside hunk
 * - Change indicators:
 *   → Changed line
 *   (space) Unchanged line
 * - Original line content
 *
 * Example input:
 * ```
 * function example() {
 *   const x = 1;
 *   return x;
 * }
 * ```
 *
 * With changes to line 2, the output would be:
 * ```
 *    1| function example() {
 *    2|⊢→ const x = 1;
 *    3|⊣  return x;
 *    4| }
 * ```
 *
 * @example
 * const content = "function test() {\n  return true;\n}";
 * const changes = {
 *   lineNumbers: [2],
 *   chunks: [{
 *     hunkStart: 2,
 *     hunkEnd: 2,
 *     changedLines: [2]
 *   }]
 * };
 * const formatted = prepareCodeWithLineNumbersAndHunks(content, changes);
 * Output:
 *   1| function test() {
 *   2|⊢→ return true;
 *   3| }
 */
function prepareCodeWithLineNumbersAndHunksOld(
  content: string,
  changes: FileChanges
): string {
  const lines = content.split("\n");
  return lines
    .map((line, index) => {
      const lineNumber = index + 1;

      // Find which chunk this line belongs to, if any
      const chunk = changes.chunks.find(
        (chunk) => lineNumber >= chunk.hunkStart && lineNumber <= chunk.hunkEnd
      );

      // If line is in a chunk and is changed, mark it
      const isChanged = chunk?.changedLines.includes(lineNumber);

      // Add hunk boundary markers
      const hunkMarker = chunk
        ? lineNumber === chunk.hunkStart
          ? "⊢" // start of hunk
          : lineNumber === chunk.hunkEnd
            ? "⊣" // end of hunk
            : "┃" // middle of hunk
        : " ";

      const prefix = isChanged ? "→" : " ";

      return `${lineNumber.toString().padStart(4, " ")}|${hunkMarker}${prefix}${line}`;
    })
    .join("\n");
}

function prepareCodeWithLineNumbersAndHunks(
  content: string,
  changes: FileChanges
): string {
  // Validate input to prevent processing invalid data
  if (!content || !changes?.chunks) {
    logger.warn("Invalid input to prepareCodeWithLineNumbersAndHunks");
    return "";
  }

  const lines = content.split("\n");

  // Create an efficient O(1) lookup map between line numbers and their corresponding chunks
  const lineToChunk = new Map<number, (typeof changes.chunks)[0]>();
  changes.chunks.forEach((chunk) => {
    // Map every line number within each chunk's range to that chunk
    for (let line = chunk.hunkStart; line <= chunk.hunkEnd; line++) {
      lineToChunk.set(line, chunk);
    }
  });

  // Log information about the mapping for debugging purposes
  logger.debug("Prepared line map", {
    totalLines: lines.length,
    mappedLines: lineToChunk.size,
    chunksCount: changes.chunks.length,
  });

  // Process each line to add line numbers, hunk markers, and change indicators
  return lines
    .map((line, index) => {
      const lineNumber = index + 1;
      const chunk = lineToChunk.get(lineNumber); // O(1) lookup

      // Check if this line has changes using the chunk's changedLines array
      const isChanged = chunk?.changedLines.includes(lineNumber);

      // Determine the appropriate hunk marker:
      // ⊢ for start of hunk
      // ⊣ for end of hunk
      // ┃ for middle of hunk
      // space for lines outside hunks
      const hunkMarker = chunk
        ? lineNumber === chunk.hunkStart
          ? "⊢"
          : lineNumber === chunk.hunkEnd
            ? "⊣"
            : "┃"
        : " ";

      // Add arrow (→) for changed lines, space for unchanged
      const prefix = isChanged ? "→" : " ";

      // Format final line with padded line number, markers, and content
      return `${lineNumber.toString().padStart(4, " ")}|${hunkMarker}${prefix}${line}`;
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
 * Shown when user doesn't belong to a matching org for a repo
 * @param username
 * @returns
 */
export const getNoMatchingOrgMessage = (
  username: string
) => `### Hi @${username}! 👋

Thanks for submitting your PR! I noticed you're not part of the organization that owns this repo.

Please get in touch with the repo owner or maintainers and ask them to add you to their organization in Evolua (${SITE_URL})! 🚀`;

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
