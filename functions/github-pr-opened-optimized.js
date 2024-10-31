const middy = require("@middy/core")
const ssm = require("@middy/ssm")
const github = require("./lib/github-helper")
const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime")
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb")
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb")

// Initialize clients
const bedrockClient = new BedrockRuntimeClient()
const ddbClient = new DynamoDBDocumentClient({
  client: new DynamoDBClient(),
  marshallOptions: { removeUndefinedValues: true },
})

const { SSM_STAGE_NAME, CACHE_TABLE_NAME = "EvaluaCodeCache" } = process.env

// Constants
const CACHE_TTL = 24 * 60 * 60 // 24 hours in seconds
const MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"

// System prompt with strong guardrails
const SYSTEM_PROMPT = `You are a code review assistant specialized in identifying security vulnerabilities, code quality issues, and best practice violations. 

Guidelines:
- Focus only on concrete, actionable findings
- Use specific line numbers and code references
- Cite relevant CWE IDs, OWASP categories, or standard best practices
- Maintain consistent risk evaluation criteria
- Do not comment on style preferences or minor formatting
- Avoid speculative or ambiguous findings
- Reference only the code provided, no external assumptions

Format all output as strict JSON matching the provided schema.`

const promptTemplate = `Analyze the following source code for potential security vulnerabilities, code quality issues, and best practice violations.

List findings in <findings> tag using the following JSON format.
Do not provide any comment besides the findings list.

<JSON format>
{
  "summary": {
    "total_issues": <number>,
    "risk_levels": {
      "critical": <number>,
      "high": <number>,
      "medium": <number>,
      "low": <number>
    }
  },
  "issues": [
    {
      "id": "VULN-001",
      "type": "vulnerability|code_quality|best_practice",
      "risk_level": "critical|high|medium|low",
      "title": "Brief description",
      "location": {
        "line_start": <number>,
        "line_end": <number>
      },
      "description": "Detailed explanation of the issue",
      "impact": "Potential consequences",
      "recommendation": "How to fix",
      "cwe_id": "CWE-XXX (if applicable)"
    }
  ]
}
</JSON format>`

// Helper Functions
const generateCacheKey = (fileContent) => {
  const crypto = require("crypto")
  return crypto.createHash("sha256").update(fileContent).digest("hex")
}

const getCachedResults = async (cacheKey) => {
  try {
    const result = await ddbClient.send(
      new GetCommand({
        TableName: CACHE_TABLE_NAME,
        Key: { cacheKey },
      })
    )

    if (result.Item && result.Item.ttl > Math.floor(Date.now() / 1000)) {
      console.log("Cache hit for:", cacheKey)
      return result.Item.findings
    }
  } catch (error) {
    console.warn("Cache retrieval error:", error)
  }
  return null
}

const cacheResults = async (cacheKey, findings) => {
  try {
    await ddbClient.send(
      new PutCommand({
        TableName: CACHE_TABLE_NAME,
        Item: {
          cacheKey,
          findings,
          ttl: Math.floor(Date.now() / 1000) + CACHE_TTL,
        },
      })
    )
  } catch (error) {
    console.warn("Cache storage error:", error)
  }
}

const analyzeFile = async (file) => {
  const cacheKey = generateCacheKey(file.content)
  const cachedResults = await getCachedResults(cacheKey)

  if (cachedResults) {
    return cachedResults
  }

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
              text: `${promptTemplate}\n\n<source code>\n${file.content}\n</source code>`,
            },
          ],
        },
      ],
    })
  )

  const output = resp.output?.message?.content
    ?.map((msg) => msg.text)
    .join("\n\n")

  try {
    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/
    const findings = JSON.parse(output.match(findingsRegex)[1])
    await cacheResults(cacheKey, findings)
    return findings
  } catch (error) {
    console.error("Error parsing AI response:", error)
    throw new Error("Failed to parse AI response")
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
