import Anthropic from "@anthropic-ai/sdk"
import { Message } from "@anthropic-ai/sdk/resources"
import { Logger } from "@aws-lambda-powertools/logger"
import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime"
import { Sema } from "async-sema"
import { commentOnPR, fetchPRFiles, init } from "./lib/github-helper"
import { AnalysisResult, AnalysisResults, PRFile } from "./types/scan-types"

const logger = new Logger()

const middy = require("@middy/core")
const ssm = require("@middy/ssm")

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Initialize Bedrock client
const bedrockClient = new BedrockRuntimeClient()

const { SSM_STAGE_NAME, BY_PASS_BEDROCK } = process.env
const MODEL_ID = "claude-3-5-sonnet-20241022"
const byPassBedrock = BY_PASS_BEDROCK === "true"

// System prompt with strong guardrails
const SYSTEM_PROMPT = `You are a Senior Software Engineer specialized in code review assistance focused on code security, quality, performance and best practices. Your analysis must be:
- Precise: Use specific line numbers and code references
- Evidence-based: Only report issues clearly present in the code
- Standardized: Reference industry standards (CWE IDs, OWASP categories, or standard best practices)
- Consistent: Use uniform risk evaluation criteria
- Actionable: Provide specific, implementable fixes using MDX Markdown format when necessary

Never include opinions, style preferences, or speculative issues.`

const promptTemplate = `Analyze the following source code for potential security vulnerabilities, code quality issues, and best practice violations.

List findings in <findings> tag using the following JSON format.
Do not provide any comment besides the findings list.

Schema:
{
  "summary": {
    "total_issues": number,
    "risk_levels": {
      "critical": number, // Immediate security risk
      "high": number,     // Significant vulnerability or quality issue
      "medium": number,   // Important but not urgent issue
      "low": number       // Minor issue worth noting
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
      "description": string,      // Detailed explanation with code evidence.
      "impact": string,           // Specific consequences if not addressed
      "recommendation": string,   // Concrete steps to fix the issue, using MDX Markdown format if necessary.
      "cwe_id": string,           // CWE identifier if applicable (e.g., "CWE-287")
      "references": {             // Optional: Industry standard references
        "standard": string,       // e.g., "OWASP", "CERT", "ISO-27001"
        "rule_id": string         // e.g., "A1:2021", "MSC21-C"
      }
    }
  ]
}

Analyze the following code:

<source code>
{code}
</source code>`

const sendMessage = async (
  content: string
): Promise<ConverseCommandOutput | Message> => {
  const maxTokens = 1024
  const message = `${promptTemplate}\n\n<source code>\n${content}\n</source code>`

  if (byPassBedrock) {
    return await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    })
  } else {
    return await bedrockClient.send(
      new ConverseCommand({
        modelId: MODEL_ID,
        system: [
          {
            text: SYSTEM_PROMPT,
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                text: message,
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens,
        },
      })
    )
  }
}

const analyzeFile = async (
  file: PRFile & { content: string }
): Promise<AnalysisResults | null> => {
  try {
    const normalizedContent = file.content.trim()
    const resp = (await sendMessage(normalizedContent)) as any // TODO: Fix type
    const content = resp?.output?.message?.content || resp?.content

    /**
     * Example output:
     * "<findings>{"summary": {"total_issues": 1}, "issues": [...]}</findings>"
     */
    const output = content?.map((msg: ContentBlock) => msg.text).join("\n\n")

    if (!output) {
      throw new Error("No output received!")
    }

    // Extract content between <findings> tags. match[0] includes tags, match[1] contains only the JSON content
    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/
    const match = output.match(findingsRegex)
    logger.info("****************************** MATCH")
    logger.info("file", file.path)

    if (!match?.[1]) {
      logger.info("No findings in the response.")
      return null
    }

    return JSON.parse(match[1])
  } catch (error) {
    logger.error("Error analyzing file:", error as Error)
    throw new Error(
      `Failed to analyze ${file.path}: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }
}

const processFiles = async (
  files: PRFile[],
  concurrencyLimit: number
): Promise<AnalysisResult[]> => {
  // Initialize semaphore with concurrency limit
  const sema = new Sema(concurrencyLimit, {
    capacity: files.length,
    pauseFn: () => logger.info("Rate limit reached, pausing..."),
    resumeFn: () => logger.info("Resuming analysis..."),
  })

  // Filter out files with null content before processing
  const validFiles = files.filter(
    (file): file is PRFile & { content: string } => {
      if (!file.content) {
        console.warn(`Skipping file ${file.path} due to null content`)
        return false
      }
      return true
    }
  )

  // Create an array of promises for all valid files
  const analysisPromises = validFiles.map(async (file) => {
    // Acquire semaphore before processing
    await sema.acquire()
    try {
      const findings = await analyzeFile(file)

      if (findings && findings.issues.length > 0) {
        logger.info(`Found ${findings.issues.length} issues in ${file.path}`)
        return { file, findings }
      }

      return null
    } catch (error) {
      logger.error(`Error analyzing ${file.path}:`, error as Error)
      return null
    } finally {
      // Release semaphore after processing
      sema.release()
    }
  })

  // Wait for all analysis to complete
  const analysisResults = await Promise.all(analysisPromises)

  // Filter out null results
  return analysisResults.filter(Boolean) as AnalysisResult[]
}

const _handler = async (event: any, context: any) => {
  const detail = event.detail

  // Initialize GitHub client
  const installationId = detail.data.installation.id
  const ghAppId = context.GITHUB_APP_ID
  const ghPrivateKey = context.GITHUB_PRIVATE_KEY
  await init(ghAppId, ghPrivateKey, installationId)

  // Fetch PR files
  const prFileContent = await fetchPRFiles(
    detail.data.repository.owner.login,
    detail.data.repository.name,
    detail.data.pull_request.number
  )

  // Process files with concurrency control
  const CONCURRENCY_LIMIT = 5
  const results = await processFiles(prFileContent, CONCURRENCY_LIMIT)

  // Post comments for all findings
  await Promise.all(
    results.map(async ({ file, findings }) => {
      const issues = findings.issues
        .map((issue) => JSON.stringify(issue, null, 2))
        .map((json) => `\`\`\`json\n${json}\n\`\`\``)
        .join("\n\n")

      const comment = `${file.path}: **${findings.issues.length} issues found**\n\n${issues}`
      return await commentOnPR(detail.data.pull_request.node_id, comment)
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

export const handler = middy().use(ssm(ssmConfig)).handler(_handler)
