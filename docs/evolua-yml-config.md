# Evolua Configuration Guide

Evolua provides a way to customize code reviews through a configuration file placed in the root of your repository. The configuration file, named `evolua.yml`, allows you to define how the AI code reviewer analyzes your code.

## Getting Started

Create an `evolua.yml` file in the root of your repository:

```yaml
# yaml-language-server: $schema=https://evolua.io/schema/evolua-config-schema.json
review:
  profile: standard
  language: en
  focus_areas:
    security: true
    code_quality: true
    best_practices: true
    performance: true
  path_filters:
    - "!node_modules/**"
    - "!dist/**"
    - "src/**/*.{ts,tsx,js,jsx}"
  path_instructions:
    - path: "src/components/**/*.tsx"
      instructions: |
        Review React components for proper state management, effect handling, and performance optimizations.
        Check for missing dependency arrays in useEffect hooks.
        Ensure proper error handling and loading states.
    - path: "src/api/**/*.ts"
      instructions: |
        Carefully check for security issues in API endpoints.
        Verify input validation and error handling.
        Ensure proper authentication checks.
```

> **Tip**: The `$schema` reference provides IDE integration for validation, autocompletion, and documentation while editing your configuration file.

## Configuration Reference

### `review`

The main configuration section for code reviews.

#### `profile`

Sets how strict the reviews should be.

- **Type**: `string`
- **Options**: `standard` (default), `strict`
- **Example**: `profile: strict`

#### `language`

Specifies the language for reviews.

- **Type**: `string`
- **Default**: `en`
- **Example**: `language: en`

#### `custom_instructions`

Optional custom instructions to add to all code reviews.

- **Type**: `string`
- **Example**:
  ```yaml
  custom_instructions: |
    Focus on readability and maintainability.
    Highlight opportunities for code reuse.
    Pay special attention to error handling patterns.
  ```

#### `focus_areas`

Configure which types of issues the AI should focus on.

- **Type**: `object`
- **Properties**:
  - `security` (boolean): Focus on security vulnerabilities
  - `code_quality` (boolean): Focus on code quality issues
  - `best_practices` (boolean): Focus on best practices
  - `performance` (boolean): Focus on performance optimizations
- **Example**:
  ```yaml
  focus_areas:
    security: true
    code_quality: true
    best_practices: true
    performance: false
  ```

#### `path_filters`

Include or exclude files from analysis using glob patterns.

- **Type**: `array` of `string`
- **Pattern**:
  - Patterns starting with `!` exclude files
  - Other patterns include files
- **Example**:
  ```yaml
  path_filters:
    - "!dist/**"
    - "!node_modules/**"
    - "src/**/*.js"
    - "lib/**/*.ts"
  ```

#### `path_instructions`

Special instructions for specific file paths.

- **Type**: `array` of `object`
- **Properties**:
  - `path`: Glob pattern for matching files
  - `instructions`: Special instructions for matching files
- **Example**:
  ```yaml
  path_instructions:
    - path: "server/**/*.js"
      instructions: |
        Check for proper error handling with async/await.
        Ensure all database queries are properly parameterized.
        Look for potential memory leaks in resource management.
    - path: "**/*.test.{js,ts}"
      instructions: "Ensure tests cover edge cases and error scenarios."
  ```

## Examples

### Focusing on Security

```yaml
review:
  profile: strict
  focus_areas:
    security: true
    code_quality: false
    best_practices: false
    performance: false
  custom_instructions: |
    Focus exclusively on security vulnerabilities.
    Check for injection vulnerabilities, authentication issues, 
    authorization bypasses, and data exposure risks.
  path_filters:
    - "api/**/*"
    - "server/**/*"
```

### Language-Specific Review

```yaml
review:
  profile: standard
  path_instructions:
    - path: "**/*.py"
      instructions: |
        Follow PEP 8 style guide.
        Check for proper type hints.
        Ensure exception handling follows best practices.
    - path: "**/*.go"
      instructions: |
        Follow Go idioms and best practices.
        Check for proper error handling patterns.
        Ensure concurrent code is safe.
```

### Frontend Focus

```yaml
review:
  profile: standard
  path_filters:
    - "src/**/*.{js,ts,jsx,tsx}"
    - "!**/*.test.{js,ts,jsx,tsx}"
  path_instructions:
    - path: "src/components/**/*.{jsx,tsx}"
      instructions: |
        Check for accessibility issues.
        Ensure proper React hooks usage.
        Look for potential memory leaks in useEffect cleanup.
    - path: "src/state/**/*.{js,ts}"
      instructions: |
        Ensure state management follows immutability principles.
        Check for proper action typing.
        Verify reducers handle all cases.
```
