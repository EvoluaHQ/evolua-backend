import { DynamoDB } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb"
import * as ulid from "ulid"
import * as helper from "./dynamodb-helper"
import { ScanResult, Summary } from '../types/index'

const dynamodbClient = new DynamoDB()
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient)

const SCANS_TABLE_NAME = process.env.SCANS_TABLE_NAME || ""
const SCAN_RESULTS_TABLE_NAME = process.env.SCAN_RESULTS_TABLE_NAME || ""

if (!SCANS_TABLE_NAME) {
  throw new Error("SCANS_TABLE_NAME env var is missing")
}

if (!SCAN_RESULTS_TABLE_NAME) {
  throw new Error("SCAN_RESULTS_TABLE_NAME env var is missing")
}

export interface PullRequest {
  id: string
  number: number
  url: string
  title: string
  createdAt: string
}

export async function saveScanResults(
  repoId: string,
  pr: PullRequest,
  results: ScanResult[]
) {
  const timestamp = new Date().toISOString()
  const prId = pr.id.toString()
  const scanId = ulid.ulid()

  const countIssues = (f: (summary: Summary) => number) => {
    return results.reduce((acc, result) => acc + f(result.findings.summary), 0)
  }

  await DocumentClient.send(
    new PutCommand({
      TableName: SCANS_TABLE_NAME,
      Item: {
        repoId,
        scanId,
        timestamp,
        pullRequestId: prId,
        pullRequest: pr,
        filesScanned: results.length,
        issuesCount: countIssues((summary) => summary.totalIssues),
        critical: countIssues((summary) => summary.riskLevels.critical),
        high: countIssues((summary) => summary.riskLevels.high),
        medium: countIssues((summary) => summary.riskLevels.medium),
        low: countIssues((summary) => summary.riskLevels.low),
      },
    })
  )

  const saveResultsReqs = results.map((result) => ({
    PutRequest: {
      Item: {
        scanId,
        file: result.file.path,
        timestamp,
        changes: {
          additions: result.file.additions,
          deletions: result.file.deletions,
          changeType: result.file.changeType,
          sha: result.file.sha,
        },
        issuesCount: result.findings.summary.totalIssues,
        critical: result.findings.summary.riskLevels.critical,
        high: result.findings.summary.riskLevels.high,
        medium: result.findings.summary.riskLevels.medium,
        low: result.findings.summary.riskLevels.low,
        issues: result.findings.issues,
      },
    },
  }))

  await helper.executeBatchWriteCommand(
    DocumentClient,
    SCAN_RESULTS_TABLE_NAME,
    saveResultsReqs
  )
}
