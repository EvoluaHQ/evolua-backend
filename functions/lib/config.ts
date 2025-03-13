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

    // Path filters - keep both default and user filters
    // User excludes (starting with !) are added to default excludes
    // User includes (not starting with !) are kept as is
    if (
      userConfig.review.path_filters &&
      userConfig.review.path_filters.length > 0
    ) {
      const defaultFilters = mergedConfig.review.path_filters || [];
      const userFilters = userConfig.review.path_filters;

      // Extract default excludes (starting with !)
      const defaultExcludes = defaultFilters.filter((pattern) =>
        pattern.startsWith("!")
      );

      // Extract user excludes and includes
      const userExcludes = userFilters.filter((pattern) =>
        pattern.startsWith("!")
      );
      const userIncludes = userFilters.filter(
        (pattern) => !pattern.startsWith("!")
      );

      // Combine: Put excludes first (both default and user), then includes
      mergedConfig.review.path_filters = [
        ...defaultExcludes,
        ...userExcludes,
        ...userIncludes,
      ];
    }

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
 * Unified file filtering function using path_filters to determine if files should be skipped
 *
 * @param filePath - The path of the file to check
 * @param config - The evolua configuration (or undefined if not yet loaded)
 * @returns True if the file should be skipped, false otherwise
 */
export function shouldSkipFileBasedOnConfig(
  filePath: string,
  config?: EvoluaConfig
): boolean {
  // Start with the default config path filters
  const defaultPathFilters = DEFAULT_CONFIG.review.path_filters || [];

  // If there's a user config, use its path_filters (if any) or fall back to the defaults
  const pathFilters = config?.review.path_filters || defaultPathFilters;

  if (!pathFilters || pathFilters.length === 0) {
    return false;
  }

  const include: string[] = [];
  const exclude: string[] = [];

  // Split filters into includes and excludes
  pathFilters.forEach((pattern) => {
    if (pattern.startsWith("!")) {
      exclude.push(pattern.substring(1));
    } else {
      include.push(pattern);
    }
  });

  // If there are includes and the file doesn't match any, skip it
  if (include.length > 0 && !matchesAnyPattern(filePath, include)) {
    logger.debug(`Skipping file not matching any include pattern: ${filePath}`);
    return true;
  }

  // If the file matches any exclude pattern, skip it
  if (exclude.length > 0 && matchesAnyPattern(filePath, exclude)) {
    logger.debug(`Skipping file matching exclude pattern: ${filePath}`);
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

  // Add focus areas section
  let focusAreas = [];

  if (focus_areas?.security)
    focusAreas.push(
      "Security: Identify vulnerabilities, data exposure, and unsafe operations"
    );
  if (focus_areas?.code_quality)
    focusAreas.push(
      "Code Quality: Evaluate performance, maintainability, and error handling"
    );
  if (focus_areas?.best_practices)
    focusAreas.push(
      "Best Practices: Assess adherence to design patterns and coding standards"
    );
  if (focus_areas?.performance)
    focusAreas.push(
      "Performance: Identify potential bottlenecks and inefficient code patterns"
    );

  return focusAreas.map((area, i) => `${i + 1}. ${area}`).join("\n");
}
