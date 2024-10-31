const middy = require("@middy/core")
const ssm = require("@middy/ssm")
const github = require("./lib/github-helper")
const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime")

// Initialize Bedrock client
const bedrockClient = new BedrockRuntimeClient()

const { SSM_STAGE_NAME } = process.env
const MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"

// System prompt with strong guardrails
const SYSTEM_PROMPT = `You are a Senior Software Engineer specialized in code review assistance focused on security, quality, performance and best practices review. Your analysis must be:
- Precise: Use specific line numbers and code references
- Evidence-based: Only report issues clearly present in the code
- Standardized: Reference industry standards (CWE IDs, OWASP categories, or standard best practices)
- Consistent: Use uniform risk evaluation criteria
- Actionable: Provide specific, implementable fixes using MDX Markdown format when necessary

Also:
- Never include opinions, style preferences, or speculative issues.
- Format all output as strict JSON matching the provided schema.`

const promptTemplate = `Analyze the provided source code for concrete issues in these categories:
1. Security vulnerabilities
2. Code quality issues
3. Best practice violations

Rules:
- Only report issues that are clearly present in the code
- Include specific line numbers for each issue
- Reference industry standards where applicable
- Focus on significant issues, not style preferences
- Avoid speculative or ambiguous findings
- Maintain consistent risk evaluation criteria

Required output format: Wrap the JSON response in <findings> tags.

Schema:
{
  "summary": {
    "total_issues": number,
    "risk_levels": {
      "critical": number, // Immediate security risk
      "high": number,     // Significant vulnerability or quality issue
      "medium": number,   // Important but not urgent issue
      "low": number      // Minor issue worth noting
    }
  },
  "issues": [
    {
      "id": string,         // Unique identifier (e.g., "VULN-001", "QUAL-002")
      "type": string,       // One of: "vulnerability", "code_quality", "best_practice"
      "risk_level": string, // One of: "critical", "high", "medium", "low"
      "title": string,      // Brief, specific description (max 100 chars)
      "location": {
        "line_start": number,
        "line_end": number
      },
      "description": string,      // Detailed explanation with code evidence
      "impact": string,          // Specific consequences if not addressed
      "recommendation": string,  // Concrete steps to fix the issue
      "cwe_id": string,         // CWE identifier if applicable (e.g., "CWE-287")
      "references": {           // Optional: Industry standard references
        "standard": string,     // e.g., "OWASP", "CERT", "ISO-27001"
        "rule_id": string      // e.g., "A1:2021", "MSC21-C"
      }
    }
  ]
}

Analyze the following code:

<source code>
{code}
</source code>`

// Helper function to analyze a single file
const analyzeFile = async (file) => {
  try {
    // Normalize the code content to ensure consistent caching
    const normalizedContent = file.content.trim()

    const resp = await bedrockClient.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                text: `${promptTemplate}\n\n<source code>\n${normalizedContent}\n</source code>`,
              },
            ],
            /**
             * Set cache control to ephemeral to avoid caching sensitive data
             * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
             **/
            cache_control: { type: "ephemeral" },
          },
        ],
      })
    )

    const output = resp.output?.message?.content
      ?.map((msg) => msg.text)
      .join("\n\n")

    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/
    return JSON.parse(output.match(findingsRegex)[1])
  } catch (error) {
    console.error("Error analyzing file:", error)
    throw new Error(`Failed to analyze ${file.path}: ${error.message}`)
  }
}

/**
 * @param {import('aws-lambda').EventBridgeEvent<'pull_request.opened', GitHubEventDetail>} event
 */
const _handler = async (event, context) => {
  const detail = event.detail

  // Initialize GitHub client
  const installationId = detail.data.installation.id
  const ghAppId = context.GITHUB_APP_ID
  const ghPrivateKey = context.GITHUB_PRIVATE_KEY
  await github.init(ghAppId, ghPrivateKey, installationId)

  // Fetch PR files
  const prFileContent = await github.fetchPRFiles(
    detail.data.repository.owner.login,
    detail.data.repository.name,
    detail.data.pull_request.number
  )

  // Process files in batches to avoid memory issues
  const BATCH_SIZE = 5
  const results = []

  for (let i = 0; i < prFileContent.length; i += BATCH_SIZE) {
    const batch = prFileContent.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        try {
          const findings = await analyzeFile(file)
          if (findings.issues.length > 0) {
            console.log(
              `Found ${findings.issues.length} issues in ${file.path}`
            )
            return { file, findings }
          }
        } catch (error) {
          console.error(`Error analyzing ${file.path}:`, error)
          return null
        }
      })
    )
    results.push(...batchResults.filter(Boolean))
  }

  // Post comments for all findings
  await Promise.all(
    results.map(async ({ file, findings }) => {
      const issues = findings.issues
        .map((issue) => JSON.stringify(issue, null, 2))
        .map((json) => `\`\`\`json\n${json}\n\`\`\``)
        .join("\n\n")

      const comment = `${file.path}: **${findings.issues.length} issues found**\n\n${issues}`
      await github.commentOnPR(detail.data.pull_request.node_id, comment)
    })
  )

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "PR review completed",
      filesAnalyzed: prFileContent.length,
      issuesFound: results.reduce(
        (sum, { findings }) => sum + findings.issues.length,
        0
      ),
    }),
  }
}

// Middleware configuration
const ssmConfig = {
  cache: true,
  cacheExpiry: 5 * 60 * 1000, // 5 mins
  setToContext: true,
  fetchData: {
    GITHUB_APP_ID: `/evolua/${SSM_STAGE_NAME}/github/app-id`,
    GITHUB_PRIVATE_KEY: `/evolua/${SSM_STAGE_NAME}/github/private-key`,
  },
}

module.exports.handler = middy(_handler).use(ssm(ssmConfig))
