# Evolua Configuration Documentation

This documentation explains how to customize Evolua AI code reviews using the `evolua.yml` configuration file.

## Quick Start

1. Create an `evolua.yml` file in the root of your repository.
2. Add configuration options to customize the AI code review behavior.
3. Commit and push the file to your repository.

Evolua will automatically detect and use this configuration file on your next pull request review.

## Basic Example

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
    - "src/**/*.{js,ts}"
```

## JSON Schema Support

The configuration file includes a reference to a JSON schema that enables IDE features:

- **Validation**: Get immediate feedback on syntax errors or invalid options
- **Autocompletion**: See available configuration options as you type
- **Documentation**: Hover over options to see descriptions and expected values

These features work in editors like VS Code with the YAML extension installed.

## Why Use a Configuration File?

- **Customized Reviews**: Get feedback that's tailored to your project's specific needs
- **Path-Specific Instructions**: Provide different review guidelines for different parts of your codebase
- **Focus Areas**: Emphasize what matters most for your team (security, performance, etc.)
- **Exclusions**: Skip files or directories that don't need review

## Configuration Options

For detailed configuration options, see the [full configuration guide](./evolua-yml-config.md).

## Example Configurations

We provide several example configurations for different use cases:

- [Basic configuration](../examples/evolua.yml)
- See more examples in the [full configuration guide](./evolua-yml-config.md#examples)

## Need Help?

If you have questions about configuring Evolua, please contact our support at support@evolua.io.
