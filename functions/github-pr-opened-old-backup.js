const middy = require("@middy/core")
const ssm = require("@middy/ssm")
const github = require("./lib/github-helper")
const scans = require("./lib/scans")
const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime")
const bedrockClient = new BedrockRuntimeClient()
const { GitHubPROpenedEventDetail } = require("./github-webhook.event")

const Anthropic = require("@anthropic-ai/sdk")

const { SSM_STAGE_NAME } = process.env
const ANTHROPIC_API_KEY =
  "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"
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
})

const SYSTEM_PROMPT = `You are a code review assistant focused on security, quality, and best practices. Analyze code for issues matching these criteria:
1. Security: vulnerabilities and weaknesses
2. Quality: maintainability and performance
3. Best Practices: standard patterns and guidelines

Keep responses concise and structured. Only report concrete, evidence-based issues.`

const ANALYSIS_PROMPT = `Analyze the provided code for security vulnerabilities, code quality issues, and best practice violations.
Return findings in <findings> tags using this JSON schema:

{
  "summary": {
    "total_issues": number,
    "risk_levels": {
      "critical": number,
      "high": number,
      "medium": number,
      "low": number
    }
  },
  "issues": [
    {
      "id": string,                // e.g., "VULN-001", "QUAL-002"
      "type": "vulnerability|code_quality|best_practice",
      "risk_level": "critical|high|medium|low",
      "title": string,
      "location": { "line_start": number, "line_end": number },
      "description": string,
      "impact": string,
      "recommendation": string,   // Steps to fix the issue. Use MDX Markdown format if necessary to show code snippets
      "cwe_id": string,           // e.g., "CWE-287"
      "references": {             // Optional: Industry standard references
        "standard": string,       // e.g., "OWASP", "CERT", "ISO-27001"
        "rule_id": string         // e.g., "A1:2021", "MSC21-C"
      }
    }
  ]
}`

/**
 * @param {import('aws-lambda').EventBridgeEvent<'pull_request.opened', GitHubPROpenedEventDetail>} event
 */
const _handler = async (event, context) => {
  // see examples/github/pr-opened.json for an example event
  const detail = event.detail

  const installationId = detail.data.installation.id
  const ghAppId = context.GITHUB_APP_ID
  const ghPrivateKey = context.GITHUB_PRIVATE_KEY

  await github.init(ghAppId, ghPrivateKey, installationId)
  const prFileContent = await github.fetchPRFiles(
    detail.data.repository.owner.login,
    detail.data.repository.name,
    detail.data.pull_request.number
  )

  const scanResultPromises = prFileContent.map(async (file) => {
    const message = `${ANALYSIS_PROMPT}\n\n<source code>\n${file.content}\n</source code>`

    const resp = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      temperature:  0.1,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }]
    })

    const output = resp.content.map(msg => msg.text).join("\n\n")

//     const resp = await bedrockClient.send(
//       new ConverseCommand({
//         modelId: "ai21.jamba-1-5-large-v1:0",
//         messages: [
//           {
//             role: "user",
//             content: [
//               {
//                 text: `${promptTemplate}

// <source code>
// ${file.content}
// </source code>`,
//               },
//             ],
//           },
//         ],
//       })
//     )

//     const output = resp.output?.message?.content
//       ?.map((msg) => msg.text)
//       .join("\n\n")

    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/
    const findings = JSON.parse(output.match(findingsRegex)[1])
    if (findings.issues.length > 0) {
      console.log(`Found ${findings.issues.length} issues in ${file.path}`)

      const issues = findings.issues
        .map((issue) => JSON.stringify(issue, null, 2))
        .map((json) => `\`\`\`json\n${json}\n\`\`\``) // format as code block in GitHub
        .join("\n\n")
      const comment = `${file.path}: **${findings.issues.length} issues found**\n\n${issues}`
      await github.commentOnPR(detail.data.pull_request.node_id, comment)
    }

    return {
      file: file.path,
      additions: file.additions,
      deletions: file.deletions,
      changeType: file.changeType,
      sha: file.sha,
      summary: findings.summary,
      issues: findings.issues,
    }
  })

  const allResults = await Promise.all(scanResultPromises)

  const repoId = `github#${detail.data.repository.id}`
  const pr = {
    id: detail.data.pull_request.id,
    number: detail.data.pull_request.number,
    url: detail.data.pull_request.url,
    title: detail.data.pull_request.title,
    createdAt: detail.data.pull_request.created_at,
  }
  await scans.saveScanResults(repoId, pr, allResults)
}

module.exports.handler = middy(_handler).use(
  ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      GITHUB_APP_ID: `/evolua/${SSM_STAGE_NAME}/github/app-id`,
      GITHUB_PRIVATE_KEY: `/evolua/${SSM_STAGE_NAME}/github/private-key`,
    },
  })
)
