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
      security: false,
      code_quality: false,
      best_practices: false,
      performance: false,
    },
    // Add default path filters that exclude common non-reviewable files and directories
    path_filters: [
      // Common package manager lock files
      "!package-lock.json",
      "!yarn.lock",
      "!pnpm-lock.yaml",
      "!composer.lock",
      "!Gemfile.lock",
      "!poetry.lock",
      "!Pipfile.lock",
      "!cargo.lock",
      "!Podfile.lock",
      "!mix.lock",

      // Common config and system files
      "!.gitignore",
      "!.gitattributes",
      "!.git/**",
      "!.npmrc",
      "!.yarnrc",
      "!.npmignore",
      "!.eslintcache",
      "!.stylelintcache",
      "!LICENSE",
      "!LICENSE.*",
      "!.editorconfig",
      "!.vscode/**",
      "!.idea/**",
      "!*.sublime-*",
      "!.DS_Store",
      "!Thumbs.db",
      "!*.bak",
      "!*~",
      "!.env",
      "!.env.*",
      "!*.env",
      "!*.swp",
      "!*.swo",

      // Common build and dependency directories
      "!dist/**",
      "!build/**",
      "!out/**",
      "!coverage/**",
      "!node_modules/**",
      "!.next/**",
      "!public/**",
      "!.nuxt/**",
      "!.output/**",
      "!.cache/**",
      "!.parcel-cache/**",
      "!tmp/**",
      "!temp/**",
      "!logs/**",

      // JavaScript/TypeScript
      "!bower_components/**",
      "!jspm_packages/**",
      "!.npm/**",
      "!.yarn/**",
      "!.pnp.*",
      "!.webpack/**",

      // Python
      "!__pycache__/**",
      "!*.py[cod]",
      "!*$py.class",
      "!.Python",
      "!env/**",
      "!venv/**",
      "!ENV/**",
      "!.venv/**",
      "!.pytest_cache/**",
      "!.tox/**",
      "!.coverage",
      "!htmlcov/**",
      "!.coverage.*",
      "!*.egg-info/**",
      "!*.egg",
      "!eggs/**",
      "!.eggs/**",
      "!develop-eggs/**",
      "!.installed.cfg",

      // Java
      "!*.class",
      "!*.jar",
      "!*.war",
      "!*.ear",
      "!*.hprof",
      "!target/**",
      "!.gradle/**",
      "!gradle/**",
      "!.classpath",
      "!.project",
      "!.settings/**",
      "!bin/**",
      "!.factorypath",
      "!.apt_generated/**",
      "!.apt_generated_tests/**",
      "!hs_err_pid*",

      // Ruby
      "!*.gem",
      "!*.rbc",
      "!.bundle/**",
      "!vendor/bundle/**",
      "!.config/**",
      "!.yardoc/**",
      "!_yardoc/**",

      // C/C++
      "!*.o",
      "!*.ko",
      "!*.obj",
      "!*.elf",
      "!*.ilk",
      "!*.map",
      "!*.exp",
      "!*.gch",
      "!*.pch",
      "!*.lib",
      "!*.a",
      "!*.la",
      "!*.lo",
      "!*.dll",
      "!*.so",
      "!*.so.*",
      "!*.dylib",
      "!*.exe",
      "!*.out",
      "!*.app",
      "!*.i*86",
      "!*.x86_64",
      "!*.hex",
      "!CMakeCache.txt",
      "!CMakeFiles/**",
      "!cmake-build-*/**",

      // Go
      "!Godeps/**",
      "!vendor/**",
      "!_vendor/**",

      // Swift/iOS
      "!*.xcodeproj/**",
      "!*.xcworkspace/**",
      "!xcuserdata/**",
      "!DerivedData/**",
      "!.build/**",
      "!Pods/**",
      "!*.pbxuser",
      "!*.mode1v3",
      "!*.mode2v3",
      "!*.perspectivev3",
      "!*.xcuserstate",

      // Rust
      "!target/**",
      "!**/*.rs.bk",

      // .NET
      "!bin/**",
      "!obj/**",
      "!*.nupkg",
      "!packages/**",
      "!artifacts/**",
      "!*.pidb",
      "!*.svclog",
      "!*.userprefs",
      "!*.dbmdl",
      "!*.jfm",

      // Common binary/asset file types
      "!**/*.map",
      "!**/*.min.js",
      "!**/*.min.css",
      "!**/*.svg",
      "!**/*.png",
      "!**/*.jpg",
      "!**/*.jpeg",
      "!**/*.gif",
      "!**/*.ico",
      "!**/*.pdf",
      "!**/*.ttf",
      "!**/*.woff",
      "!**/*.woff2",
      "!**/*.eot",
      "!**/*.mp3",
      "!**/*.mp4",
      "!**/*.mov",
      "!**/*.avi",
      "!**/*.zip",
      "!**/*.tar",
      "!**/*.gz",
      "!**/*.7z",
      "!**/*.rar",
    ],
  },
};
