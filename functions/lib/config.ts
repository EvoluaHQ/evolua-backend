import { Logger } from "@aws-lambda-powertools/logger";
import { Octokit } from "@octokit/rest";
import * as yaml from "js-yaml";
import { DEFAULT_CONFIG, EvoluaConfig } from "../types/config";

const logger = new Logger();

/**
 * Fetches and parses the evolua.yml configuration file from a GitHub repository.
 *
 * @param octokit - Initialized Octokit instance with authentication
 * @param owner - Repository owner (username or organization)
 * @param repo - Repository name
 * @param ref - Git reference (branch, commit SHA)
 * @returns The parsed configuration or the default configuration if no file exists
 */
export async function loadConfigFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string
): Promise<EvoluaConfig> {
  try {
    // Try to fetch the evolua.yml file from the repository
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: ".evolua.yml",
      ref,
    });

    // If the file exists, parse it
    if ("content" in response.data && "encoding" in response.data) {
      const content = Buffer.from(
        response.data.content,
        response.data.encoding as BufferEncoding
      ).toString();

      // Parse the YAML content
      const config = yaml.load(content) as Partial<EvoluaConfig>;

      // Merge with default config to ensure all required fields exist
      return mergeWithDefaultConfig(config);
    }
  } catch (error: any) {
    // If the file doesn't exist (404) or any other error occurs, use the default config
    if (error.status !== 404) {
      logger.warn("Error fetching evolua.yml config file", { error });
    } else {
      logger.info(
        "No evolua.yml config file found, using default configuration"
      );
    }
  }

  // Return the default configuration if no file exists or there was an error
  return { ...DEFAULT_CONFIG };
}

/**
 * Merges the user-provided configuration with the default configuration
 * to ensure all required fields exist.
 *
 * @param userConfig - The user-provided configuration object
 * @returns A complete configuration object with defaults applied where needed
 */
export function mergeWithDefaultConfig(
  userConfig: Partial<EvoluaConfig>
): EvoluaConfig {
  // Create a deep copy of the default config
  const mergedConfig: EvoluaConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // If no user config, return default
  if (!userConfig) {
    return mergedConfig;
  }

  // Merge review settings
  if (userConfig.review) {
    // Basic properties
    if (userConfig.review.profile)
      mergedConfig.review.profile = userConfig.review.profile;
    if (userConfig.review.language)
      mergedConfig.review.language = userConfig.review.language;
    if (userConfig.review.custom_instructions)
      mergedConfig.review.custom_instructions =
        userConfig.review.custom_instructions;

    // Path filters
    if (userConfig.review.path_filters)
      mergedConfig.review.path_filters = userConfig.review.path_filters;

    // Path instructions
    if (userConfig.review.path_instructions)
      mergedConfig.review.path_instructions =
        userConfig.review.path_instructions;

    // Focus areas
    if (userConfig.review.focus_areas) {
      mergedConfig.review.focus_areas = {
        ...mergedConfig.review.focus_areas,
        ...userConfig.review.focus_areas,
      };
    }
  }

  return mergedConfig;
}

/**
 * Updates the file filter configuration based on the config file's path_filters property
 *
 * @param config - The evolua configuration
 * @param filePath - The path of the file being analyzed
 * @returns True if the file should be skipped, false otherwise
 */
export function shouldSkipFileBasedOnConfig(
  config: EvoluaConfig,
  filePath: string
): boolean {
  if (!config.review.path_filters || config.review.path_filters.length === 0) {
    return false;
  }

  const include: string[] = [];
  const exclude: string[] = [];

  // Split filters into includes and excludes
  config.review.path_filters.forEach((pattern) => {
    if (pattern.startsWith("!")) {
      exclude.push(pattern.substring(1));
    } else {
      include.push(pattern);
    }
  });

  // If there are includes and the file doesn't match any, skip it
  if (include.length > 0 && !matchesAnyPattern(filePath, include)) {
    return true;
  }

  // If the file matches any exclude pattern, skip it
  if (exclude.length > 0 && matchesAnyPattern(filePath, exclude)) {
    return true;
  }

  return false;
}

/**
 * Checks if a file path matches any of the provided glob patterns
 *
 * @param filePath - The file path to check
 * @param patterns - The glob patterns to match against
 * @returns True if the file matches any pattern, false otherwise
 */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const regexPattern = pattern
      .replace(/\./g, "\\.") // Escape dots
      .replace(/\*\*/g, ".*") // ** becomes .*
      .replace(/\*/g, "[^/]*"); // * becomes [^/]*

    return new RegExp(regexPattern).test(filePath);
  });
}

/**
 * Finds the matching path instructions for a file
 *
 * @param config - The evolua configuration
 * @param filePath - The path of the file being analyzed
 * @returns The matching path instructions or undefined if none match
 */
export function getPathInstructionsForFile(
  config: EvoluaConfig,
  filePath: string
): string | undefined {
  if (
    !config.review.path_instructions ||
    config.review.path_instructions.length === 0
  ) {
    return undefined;
  }

  // Find all matching path instructions
  const matchingInstructions = config.review.path_instructions
    .filter((pi) => matchesAnyPattern(filePath, [pi.path]))
    .map((pi) => pi.instructions);

  // Combine all matching instructions
  if (matchingInstructions.length > 0) {
    return matchingInstructions.join("\n\n");
  }

  return undefined;
}

/**
 * Generates focus area instructions based on the config
 *
 * @param config - The evolua configuration
 * @returns Instructions for focus areas
 */
export function getFocusAreaInstructions(config: EvoluaConfig): string {
  const { focus_areas } = config.review;
  if (!focus_areas) return "";

  const areas = [];
  if (focus_areas.security) areas.push("Security vulnerabilities");
  if (focus_areas.code_quality) areas.push("Code quality issues");
  if (focus_areas.best_practices) areas.push("Best practices");
  if (focus_areas.performance) areas.push("Performance optimizations");

  if (areas.length === 0) return "";

  return `Focus primarily on these areas during your analysis: ${areas.join(", ")}.`;
}

/**
 * Builds custom review instructions based on the configuration
 *
 * @param config - The evolua configuration
 * @param filePath - Optional file path to get path-specific instructions
 * @returns Custom review instructions string
 */
export function buildCustomInstructions(
  config: EvoluaConfig,
  filePath?: string
): string {
  const instructions: string[] = [];

  // Add profile-specific instructions
  if (config.review.profile === "strict") {
    instructions.push(
      "Be extra thorough and strict in your review. Highlight even minor issues that could be improved."
    );
  }

  // Add focus area instructions
  const focusAreaText = getFocusAreaInstructions(config);
  if (focusAreaText) {
    instructions.push(focusAreaText);
  }

  // Add file-specific instructions if file path is provided
  if (filePath) {
    const pathInstructions = getPathInstructionsForFile(config, filePath);
    if (pathInstructions) {
      instructions.push(pathInstructions);
    }
  }

  // Add custom instructions if provided
  if (config.review.custom_instructions) {
    instructions.push(config.review.custom_instructions);
  }

  return instructions.join("\n\n");
}
