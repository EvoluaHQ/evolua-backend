/**
 * Types for the evolua.yml configuration file
 */

export interface PathInstructions {
  path: string;
  instructions: string;
}

export interface ReviewConfig {
  /**
   * The profile for code reviews - determines how strict the reviews are
   */
  profile?: "standard" | "strict";

  /**
   * Custom instructions to add to the system prompt for code reviews
   */
  custom_instructions?: string;

  /**
   * Language for reviews
   */
  language?: string;

  /**
   * File patterns to include or exclude in analysis
   * Uses glob patterns (e.g., '!dist/**', 'src/**')
   */
  path_filters?: string[];

  /**
   * Special instructions for specific file paths
   */
  path_instructions?: PathInstructions[];

  /**
   * Focus areas for the review
   */
  focus_areas?: {
    /**
     * Focus on security issues in the review
     */
    security?: boolean;

    /**
     * Focus on code quality issues in the review
     */
    code_quality?: boolean;

    /**
     * Focus on best practices in the review
     */
    best_practices?: boolean;

    /**
     * Focus on performance issues in the review
     */
    performance?: boolean;
  };
}

/**
 * Root configuration object
 */
export interface EvoluaConfig {
  /**
   * Review configuration
   */
  review: ReviewConfig;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: EvoluaConfig = {
  review: {
    profile: "standard",
    language: "en",
    focus_areas: {
      security: true,
      code_quality: true,
      best_practices: true,
      performance: true,
    },
  },
};
