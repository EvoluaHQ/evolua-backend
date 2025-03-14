import Anthropic from "@anthropic-ai/sdk";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { FileChanges, PRFileChanges } from "../types";
import { DEFAULT_CONFIG, EvoluaConfig } from "../types/config";
import { buildCustomInstructions } from "./config";
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
      sonnet37v1: "us.anthropic.claude-3-7-sonnet-20250219-v1:0", // cross-region inference
      sonnet35v2: "us.anthropic.claude-3-5-sonnet-20241022-v2:0", // cross-region inference
      sonnet35v1: "us.anthropic.claude-3-5-sonnet-20240620-v1:0", // cross-region inference
    },
    anthropic: {
      sonnet37v1: "claude-3-7-sonnet-20250219",
      sonnet35v2: "claude-3-5-sonnet-20241022",
    },
  },
  // Reasoning configurations for Claude models
  reasoning: {
    // Claude reasoning configuration
    defaultBudget: 2000, // Default token budget for reasoning
    complexTaskBudget: 4000, // For complex files or tasks
    maxBudgetPercentage: 0.4, // Maximum percentage of tokens to use for reasoning
    minBudget: 1024, // Minimum budget required for reasoning to be effective
  },
  // Concurrency and processing
  concurrency: {
    limit: 10, // Maximum parallel processes
    retryLimit: 3, // Maximum retry attempts
    retryDelay: 1000, // Base delay between retries (ms)
  },
} as const;

/**
 * Reasoning Model Implementation Notes:
 *
 * AWS Bedrock Implementation for Claude 3.7 Sonnet:
 * - Reasoning is configured via additionalModelRequestFields.thinking with "type": "enabled" and "budget_tokens": <token_count>
 * - IMPORTANT: When reasoning is enabled, temperature MUST be set to 1.0 per AWS documentation
 * - IMPORTANT: The "topP" parameter MUST NOT be included in the request when reasoning is enabled
 * - Valid reasoning budget values range from 1024 to 8192 tokens
 * - The budget_tokens value determines how many tokens Claude can use for step-by-step reasoning
 * - Response will include a reasoningContent object with Claude's step-by-step thinking process
 * - Reasoning is especially beneficial for complex code reviews requiring deep analysis
 * - Claude will show its work in a structured, step-by-step fashion when analyzing complex patterns
 *
 * Anthropic Direct API Implementation:
 * - Claude 3.7 Sonnet: Reasoning is configured via the thinking field with "type": "enabled" and "budget_tokens": <token_count>
 * - Unlike AWS Bedrock, Anthropic API does not require temperature=1.0 when reasoning is enabled
 * - Response will include content blocks with 'type': 'thinking' containing the reasoning process
 *
 * Response Format Differences:
 * - AWS Bedrock: response.output.message.content contains blocks with reasoningContent and text properties
 * - Anthropic API: response.content contains blocks with type property ('thinking' or 'text')
 *
 * Budget Management:
 * - Budget sizes vary based on file complexity
 * - Complex files (with async patterns, classes, etc.) receive larger reasoning budgets
 * - Budget is scaled appropriately to match content complexity
 * - The implementation detects specific code patterns that benefit from more reasoning budget
 */

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
 * Interface for AWS Bedrock reasoning configuration
 */
interface AnthropicReasoningConfig {
  type: "enabled";
  budget_tokens: number;
}

/**
 * Interface for Bedrock additional model request fields
 */
interface AnthropicAdditionalFields {
  thinking?: AnthropicReasoningConfig;
}

/**
 * Interface for Bedrock inference configuration
 */
interface BedrockInferenceConfig {
  temperature: number;
  maxTokens: number;
  topP?: number; // Must be disabled when reasoning is enabled
}

/**
 * Determines appropriate reasoning budget based on file complexity
 * @param content - The code content to analyze
 * @param filePath - The file path for type detection
 * @param tokenLimit - The total token limit for the model
 * @returns The appropriate reasoning budget for the content
 */
const getReasoningBudget = (
  content: string,
  filePath: string,
  tokenLimit: number
): number => {
  const fileType = getLanguageExtension(filePath);
  const size = content.length;

  // Use numeric constants instead of referencing the config directly to avoid type issues
  const DEFAULT_BUDGET = 2000;
  const COMPLEX_BUDGET = 4000;
  const MIN_BUDGET = 1024;
  const MAX_BUDGET_PERCENTAGE = 0.4;

  // Calculate estimated tokens in content for better budget calculation
  const estimatedContentTokens = Math.ceil(
    size / AI_ANALYSIS_CONFIG.tokens.charsPerToken
  );

  // Count the number of lines in the content
  const lineCount = content.split("\n").length;

  // Extract changed lines from hunks in the code
  const changedLinesCount = extractChangedLinesCount(content);

  // Calculate the percentage of the file that was changed
  const changePercentage =
    changedLinesCount > 0 ? Math.min(changedLinesCount + lineCount, 1) : 0.1;

  // Language-agnostic complexity metrics that work across programming languages
  const complexityMetrics = {
    // Size-based metrics
    isLargeFile: size > 10000, // Over 10KB
    isMediumFile: size > 5000 && size <= 10000, // 5-10KB

    // Line-based metrics
    hasHighLineCount: lineCount > 300, // More than 300 lines
    hasMediumLineCount: lineCount > 150 && lineCount <= 300, // 150-300 lines

    // Change-based metrics
    hasSignificantChanges: changePercentage > 0.3, // >30% of file changed
    hasModerateChanges: changePercentage > 0.1 && changePercentage <= 0.3, // 10-30% changed

    // Universal complexity indicators (found in most languages)
    hasNestedStructures: (content.match(/[{[(]/g) || []).length > 30, // Many braces/brackets
    hasHighLogicBranching:
      countOccurrences(content, /if|else|switch|case|for|while|do/g) > 15, // Many control flow statements
    hasErrorHandling:
      content.includes("try") ||
      content.includes("catch") ||
      content.includes("throw") ||
      content.includes("except") ||
      content.includes("finally"), // Basic error handling in many languages
  };

  // Count how many complexity metrics are true
  const complexityScore =
    Object.values(complexityMetrics).filter(Boolean).length;

  // Determine base budget based on complexity score
  let baseBudget = DEFAULT_BUDGET;

  // For higher complexity (3+ factors), use the complex task budget
  if (complexityScore >= 3) {
    baseBudget = COMPLEX_BUDGET;
  }

  // For extremely complex content (5+ factors), increase budget further
  if (complexityScore >= 5) {
    baseBudget = Math.min(COMPLEX_BUDGET / 1.5, 6000);
  }

  // The larger the file, the more tokens we might need for reasoning
  if (estimatedContentTokens > 5000) {
    // For very large files, increase the budget proportionally
    baseBudget = Math.min(baseBudget * 1.2, 6000);
  }

  // Ensure the budget doesn't exceed a reasonable percentage of the total token limit
  const maxAllowedBudget = Math.floor(tokenLimit * MAX_BUDGET_PERCENTAGE);

  // Final budget calculation with min/max bounds
  const budget = Math.min(Math.max(baseBudget, MIN_BUDGET), maxAllowedBudget);

  logger.debug("Calculated reasoning budget", {
    fileType,
    contentLength: size,
    estimatedContentTokens,
    lineCount,
    changedLinesCount,
    changePercentage,
    complexityScore,
    complexityMetrics,
    baseBudget,
    maxAllowedBudget,
    finalBudget: budget,
  });

  return budget;
};

/**
 * Helper function to count occurrences of a pattern in text
 */
function countOccurrences(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Extract the number of changed lines from code content
 * Assumes code has been formatted with prepareCodeWithLineNumbersAndHunks
 */
function extractChangedLinesCount(content: string): number {
  // Look for the arrow marker "→" which indicates changed lines
  const changedLineMatches = content.match(/\|[⊢⊣┃]→/g);
  return matches ? matches.length : 0;
}

/**
 * Generates a customized system prompt based on the configuration
 * @param config - The Evolua configuration (or undefined if not available)
 * @param filePath - Optional file path for path-specific instructions
 * @returns A tailored system prompt for the AI
 */
export function generateSystemPrompt(
  config?: EvoluaConfig,
  filePath?: string
): string {
  // Use default config if none provided
  const effectiveConfig = config || DEFAULT_CONFIG;

  // Base prompt that's always included
  let prompt = `You are an expert code reviewer specialized in security vulnerabilities, code quality, and best practices.`;

  // Add profile-specific guidance
  if (effectiveConfig.review.profile === "strict") {
    prompt += `\n\nYou should be extremely thorough and strict in your review, highlighting even minor issues that could be improved.`;
  } else {
    // Standard profile
    prompt += `\n\nYou should focus on significant issues while ignoring trivial matters.`;
  }

  // Get custom instructions from the config helper function
  const customInstructions = buildCustomInstructions(effectiveConfig, filePath);
  if (customInstructions) {
    prompt += `\n\n${customInstructions}`;
  }

  // Add standard guidelines
  prompt += `\n\nGuidelines:
- Use the full source code for context but ONLY report issues found in the changed lines marked with arrows (→)
- Use exact line numbers from the prefix
- Lines marked with ⊢ indicate the start of a change hunk, and ⊣ indicates the end of a hunk
- When reporting multi-line issues, ensure start_line and end_line are within the same hunk (between ⊢ and ⊣ markers)
- Do not create issues that span across different hunks - each issue must be contained within a single hunk
- Provide actionable recommendations with code examples
- Reference relevant standards (CWE, OWASP, Documentations)
- Keep responses concise and structured. Only report concrete, evidence-based issues.
- Never include opinions, style preferences, or speculative issues.
- Recommendation code must include all necessary context, imports, and surrounding code to be fully functional.`;

  // Add profile-specific risk level guidance
  if (effectiveConfig.review.profile === "strict") {
    // Strict profile - include all severity levels
    prompt += `\n\n- Assign risk levels based on severity:
  * Critical: Direct security risks (RCE, credentials exposure, etc)
  * High: Significant vulnerabilities (XSS, unsafe operations, etc)
  * Medium: Important quality issues (performance, validation, error handling, etc)
  * Low: Minor improvements (style, documentation, optimizations)`;
  } else {
    // Standard profile - focus only on critical and high severity issues
    prompt += `\n\n- Assign risk levels based on severity, focusing ONLY on critical and high issues:
  * Critical: Direct security risks (RCE, credentials exposure, etc)
  * High: Significant vulnerabilities (XSS, unsafe operations, performance, etc)
  * IGNORE Medium and Low severity issues unless they could potentially escalate to higher severity in specific contexts`;
  }

  // Add reasoning-optimized instructions for Claude models
  prompt += `\n\n## Analysis Approach
When analyzing code, I want you to employ detailed step-by-step reasoning:

1. First understand the context:
   - What is the purpose of this code?
   - What frameworks or libraries is it using?
   - How does it fit into the larger codebase?

2. For each potential issue in the changed lines, systematically analyze:
   
   A. Security implications:
      - Could there be injection vulnerabilities?
      - Are authentication/authorization mechanisms properly implemented?
      - Is sensitive data being handled securely?
      - Is input properly validated and sanitized?
   
   B. Code quality concerns:
      - Are there edge cases not being handled?
      - Is there proper error handling?
      - Could there be null/undefined values causing issues?
      - Is there redundant or duplicated code?
   
   C. Performance considerations:
      - Are there potential bottlenecks or inefficiencies?
      - Could there be memory leaks?
      - Are there better algorithms or data structures that could be used?
      - Is there proper resource cleanup?
   
   D. Best practices evaluation:
      - Does the code follow language/framework conventions?
      - Is it maintainable and readable?
      - Does it properly handle concurrency or async operations?
      - Are there better design patterns that could be applied?

3. For each identified issue:
   - Determine exact cause by examining the specific code patterns
   - Trace potential execution paths to understand impact
   - Consider both direct and indirect consequences
   - Develop a clear, specific fix that addresses the root cause

4. Provide detailed rationale for each recommendation:
   - Explain WHY it's an issue (not just WHAT)
   - Cite specific standards or documentation where relevant
   - Provide complete, production-ready code examples
   
5. When uncertain about an issue:
   - State your confidence level explicitly
   - Explain your reasoning process
   - Provide the best recommendation based on available information

This methodical analysis approach will deliver more accurate and actionable code reviews.`;

  // Add standard output format guidance
  prompt += `\n\nAlways return findings in this exact JSON format within <findings> tags, ensuring all strings use proper JSON escaping:
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

  return prompt;
}

const useBedrock = async (
  modelId: string,
  userPrompt: string,
  tokenLimit: number,
  config?: EvoluaConfig,
  filePath?: string
): Promise<string[]> => {
  logger.info("Using Bedrock for analysis", { modelId, tokenLimit });

  // Prepare inference configuration
  const inferenceConfig: BedrockInferenceConfig = {
    temperature: AI_ANALYSIS_CONFIG.model.temperature,
    maxTokens: tokenLimit,
  };

  // Setup common parameters for the ConverseCommand - using any to bypass type checking
  // In a real implementation, we would import the proper types from the AWS SDK
  const converseParams: ConverseCommandInput = {
    modelId: modelId,
    system: [{ text: generateSystemPrompt(config, filePath) }],
    messages: [
      {
        role: "user",
        content: [{ text: userPrompt }],
      },
    ],
    inferenceConfig: inferenceConfig,
  };

  // Add reasoning configuration for Claude 3.7 Sonnet
  if (modelId === AI_ANALYSIS_CONFIG.model.bedrock.sonnet37v1) {
    // Enable extended thinking mode for Claude 3.7 Sonnet
    const reasoningBudget = filePath
      ? getReasoningBudget(userPrompt, filePath, tokenLimit)
      : AI_ANALYSIS_CONFIG.reasoning.defaultBudget;

    // Validate reasoning budget is within AWS Bedrock limits
    // AWS recommends minimum of 1024 tokens and maximum cannot exceed available tokens
    const validatedBudget = Math.min(
      Math.max(reasoningBudget, 1024), // Minimum 1024 tokens as per AWS docs
      tokenLimit * 0.9 // Ensure we leave some tokens for the response
    );

    logger.info("Enabling Claude 3.7 Sonnet reasoning", {
      originalBudget: reasoningBudget,
      validatedBudget,
    });

    const additionalModelRequestFields: AnthropicAdditionalFields = {
      thinking: {
        type: "enabled",
        budget_tokens: validatedBudget,
      },
    };

    // Add reasoning configuration according to AWS documentation
    // Using additionalModelRequestFields with thinking instead of inferenceConfig.reasoningConfig
    converseParams.additionalModelRequestFields =
      additionalModelRequestFields as any; // How to avoid any here?

    // IMPORTANT: Per AWS documentation for Claude 3.7 Sonnet with reasoning:
    // 1. Temperature MUST be set to 1.0 when reasoning is enabled
    // 2. Top-P MUST be completely excluded from the request
    inferenceConfig.temperature = 1.0;

    // Delete topP completely
    delete inferenceConfig.topP;

    logger.info(
      "Applying AWS Bedrock requirements for reasoning: temperature=1.0, topP=removed"
    );
  }

  try {
    const resp = await bedrockClient.send(new ConverseCommand(converseParams));

    // Process response and extract both reasoning and final answer
    const contentBlocks = resp.output?.message?.content || [];
    const results: string[] = [];

    // Process each content block to extract reasoning and text
    for (const block of contentBlocks as any[]) {
      if (
        block.reasoningContent &&
        block.reasoningContent.reasoningText &&
        block.reasoningContent.reasoningText.text
      ) {
        logger.debug("Reasoning block found", {
          reasoningLength: block.reasoningContent.reasoningText.text.length,
        });
      }
      if (block.text) {
        // Add the regular response text
        results.push(block.text);
      }
    }

    return results;
  } catch (error) {
    logger.error("Error in AWS Bedrock API call", {
      error,
      modelId,
      hasReasoningEnabled: !!(
        converseParams.additionalModelRequestFields as AnthropicAdditionalFields
      )?.thinking,
    });
    throw error;
  }
};

/**
 * Type for Anthropic message options
 */
interface AnthropicMessageOptions {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  thinking?: AnthropicReasoningConfig;
}

const runAnthropic = async (
  modelId: string,
  userPrompt: string,
  tokenLimit: number,
  config?: EvoluaConfig,
  filePath?: string
): Promise<string[]> => {
  logger.info("Using Anthropic for analysis", { modelId, tokenLimit });

  // Create messaging options
  const messagingOptions: AnthropicMessageOptions = {
    model: modelId,
    max_tokens: tokenLimit,
    temperature: AI_ANALYSIS_CONFIG.model.temperature,
    system: generateSystemPrompt(config, filePath),
    messages: [{ role: "user", content: userPrompt }],
  };

  // For Claude 3.7 models, enable reasoning using Anthropic's format
  if (modelId === AI_ANALYSIS_CONFIG.model.anthropic.sonnet37v1) {
    const reasoningBudget = filePath
      ? getReasoningBudget(userPrompt, filePath, tokenLimit)
      : AI_ANALYSIS_CONFIG.reasoning.defaultBudget;

    // Validate reasoning budget is within Anthropic's API limits
    // Minimum of 1024 tokens is recommended for effective reasoning
    const validatedBudget = Math.min(
      Math.max(reasoningBudget, 1024), // Minimum 1024 tokens
      tokenLimit * 0.9 // Ensure we leave some tokens for the response
    );

    logger.info("Enabling Claude 3.7 Sonnet reasoning with Anthropic API", {
      originalBudget: reasoningBudget,
      validatedBudget,
    });

    messagingOptions.temperature = 0;

    // Add reasoning configuration using Anthropic's format
    messagingOptions.thinking = {
      type: "enabled",
      budget_tokens: validatedBudget,
    };

    // Note: Unlike AWS Bedrock, Anthropic API does not require temperature=1.0
    // when reasoning is enabled, so we keep the original temperature setting
  }

  try {
    // Use any to bypass type checking issues
    const resp = await anthropic.messages.create(messagingOptions);

    logger.info("Anthropic response received", {
      hasContent: !!resp.content,
      contentLength: resp.content?.length,
      hasThinking: !!messagingOptions.thinking,
    });

    const results: string[] = [];

    // Process each content block to extract reasoning and text
    if (resp.content && resp.content.length > 0) {
      // Use any[] to avoid type issues with the Anthropic SDK
      for (const block of resp.content as any[]) {
        // Check for thinking blocks (using any to bypass type checking)
        if (block.type === "thinking" && block.text) {
          logger.debug("Anthropic thinking block found", {
            thinkingLength: block.text.length,
          });
          results.push(`<thinking>\n${block.text}\n</thinking>`);
        }
        // Check for regular text blocks
        else if (
          (block.type === "text" || block.type === undefined) &&
          block.text
        ) {
          results.push(block.text);
        }
      }
    }

    return results;
  } catch (error) {
    logger.error("Error in Anthropic API call", {
      error,
      modelId,
      hasReasoningEnabled: !!messagingOptions.thinking,
    });
    throw error;
  }
};

type runAiScanFunc = (
  userPrompt: string,
  tokenLimit: number,
  config?: EvoluaConfig,
  filePath?: string
) => Promise<string[]>;

const analyzeWithFallbacks = async (
  userPrompt: string,
  tokenLimit: number,
  config?: EvoluaConfig,
  filePath?: string
): Promise<string | undefined> => {
  const aiModels = AI_ANALYSIS_CONFIG.model;
  const modelsToRun: runAiScanFunc[] = [
    (up, tl, conf, path) =>
      useBedrock(aiModels.bedrock.sonnet37v1, up, tl, conf, path),
    (up, tl, conf, path) =>
      runAnthropic(aiModels.anthropic.sonnet37v1, up, tl, conf, path),
    (up, tl, conf, path) =>
      useBedrock(aiModels.bedrock.sonnet35v2, up, tl, conf, path),
    (up, tl, conf, path) =>
      runAnthropic(aiModels.anthropic.sonnet35v2, up, tl, conf, path),
    (up, tl, conf, path) =>
      useBedrock(aiModels.bedrock.sonnet35v1, up, tl, conf, path),
  ];

  for (const runAiScan of modelsToRun) {
    try {
      const contentBlocks = await runAiScan(
        userPrompt,
        tokenLimit,
        config,
        filePath
      );
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
 * @param config - Optional configuration from evolua.yml
 * @returns Promise containing the AI service response
 */
export const sendMessage = async (
  file: PRFileChanges & { content: string },
  config?: EvoluaConfig
): Promise<string | undefined> => {
  // Get optimal token limit
  const tokenLimit = getTokenLimit(file.content);

  const codeWithLines = prepareCodeWithLineNumbersAndHunks(
    file.content.trim(),
    file.changes
  );

  // Build the base prompt - keep it simple as configuration is now in system prompt
  let USER_PROMPT = `Review the following code changes:
  
  File path: ${file.path}
  File type: ${getLanguageExtension(file.path)}
  Changed lines: ${file.changes.lineNumbers.join(", ")}`;

  // Add the source code
  USER_PROMPT += `\n\n<source code>\n${codeWithLines}\n</source code>`;

  logger.info("Sending analysis request", {
    filePath: file.path,
    fileSize: file.content.length,
    tokenLimit,
    changeCount: file.changes.lineNumbers.length,
  });

  // The configuration and file path are now passed to the system prompt via analyzeWithFallbacks
  return await analyzeWithFallbacks(USER_PROMPT, tokenLimit, config, file.path);
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
