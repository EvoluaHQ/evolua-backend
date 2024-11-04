import { Logger } from "@aws-lambda-powertools/logger"

const logger = new Logger()

/**
 * Configuration for file filtering
 */
interface FileFilterConfig {
  // Files to exclude based on exact match
  excludeFiles: string[]

  // File patterns to exclude (using glob patterns)
  excludePatterns: string[]

  // Extensions to exclude
  excludeExtensions: string[]

  // Directories to exclude
  excludeDirectories: string[]
}

/**
 * Default configuration for file filtering
 */
const DEFAULT_FILE_FILTERS: FileFilterConfig = {
  excludeFiles: [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "composer.lock",
    "Gemfile.lock",
    "poetry.lock",
    ".gitignore",
    ".npmrc",
    ".yarnrc",
    "LICENSE",
  ],
  excludePatterns: [
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/node_modules/**",
    "**/.next/**",
    "**/public/**",
  ],
  excludeExtensions: [
    ".map", // Source maps
    ".min.js", // Minified files
    ".min.css",
    ".svg", // Images/Assets
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".pdf",
    ".ttf", // Fonts
    ".woff",
    ".woff2",
    ".eot",
  ],
  excludeDirectories: [
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".git",
    ".husky",
    ".github",
  ],
}

/**
 * Helper function to check if a file should be skipped
 */
export function shouldSkipFile(
  filePath: string,
  config: FileFilterConfig = DEFAULT_FILE_FILTERS
): boolean {
  const {
    excludeFiles,
    excludePatterns,
    excludeExtensions,
    excludeDirectories,
  } = config

  // Normalize path for consistent checking
  const normalizedPath = filePath.toLowerCase()

  // Check exact file matches
  if (
    excludeFiles.some((file) => normalizedPath.endsWith(file.toLowerCase()))
  ) {
    logger.debug(`Skipping excluded file: ${filePath}`)
    return true
  }

  // Check directory exclusions
  if (
    excludeDirectories.some(
      (dir) =>
        normalizedPath.includes(`/${dir.toLowerCase()}/`) ||
        normalizedPath.startsWith(`${dir.toLowerCase()}/`)
    )
  ) {
    logger.debug(`Skipping file in excluded directory: ${filePath}`)
    return true
  }

  // Check file extensions
  if (excludeExtensions.some((ext) => normalizedPath.endsWith(ext))) {
    logger.debug(`Skipping file with excluded extension: ${filePath}`)
    return true
  }

  // Check glob patterns
  if (
    excludePatterns.some((pattern) => {
      const regexPattern = pattern
        .replace(/\./g, "\\.") // Escape dots
        .replace(/\*\*/g, ".*") // ** becomes .*
        .replace(/\*/g, "[^/]*") // * becomes [^/]*
      return new RegExp(regexPattern).test(normalizedPath)
    })
  ) {
    logger.debug(`Skipping file matching excluded pattern: ${filePath}`)
    return true
  }

  return false
}
