import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb"
import { ulid } from "ulid"
import { 
  documentClient,
  scansTableName, 
  scanResultsTableName, 
  executeBatchWriteCommand
} from "./dynamodb-helper"
import { ScanResult, Summary } from '../types/index'

export interface PullRequest {
  id: string
  number: number
  url: string
  title: string
  createdAt: string
}

export interface Scan {
  repoId: string
  scanId: string
  timestamp: string
  pullRequestId: string
  pullRequest: PullRequest
  filesScanned: number
  issuesCount: number
  critical: number
  high: number
  medium: number
  low: number
}

export async function saveScanResults(
  repoId: string,
  pr: PullRequest,
  reviewedAt: Date,
  results: ScanResult[]
) {
  const SCANS_TABLE_NAME = scansTableName();
  const SCAN_RESULTS_TABLE_NAME = scanResultsTableName();

  const timestamp = reviewedAt.toISOString()
  const prId = pr.id.toString()
  const scanId = ulid()

  const countIssues = (f: (summary: Summary) => number) => {
    return results.reduce((acc, result) => acc + f(result.findings.summary), 0)
  }

  // IMPORTANT: save the scan results first, then the scan summary
  // so that when the ScansTable's DynamoDB stream triggers the
  // algolia sync function, the scan results are already available
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

  await executeBatchWriteCommand(SCAN_RESULTS_TABLE_NAME, saveResultsReqs)

  const scanSummary: Scan = {
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
  }

  await documentClient.send(
    new PutCommand({
      TableName: SCANS_TABLE_NAME,
      Item: scanSummary
    })
  )

  return scanSummary
}

export async function getScanResults(scanId: string) {
  const SCAN_RESULTS_TABLE_NAME = scanResultsTableName();

  const results = [];
  let lastEvaluatedKey;
  do {
    const cmd = new QueryCommand({
      TableName: SCAN_RESULTS_TABLE_NAME,
      KeyConditionExpression: "scanId = :scanId",
      ExpressionAttributeValues: {
        ":scanId": scanId,
      },      
    });

    if (lastEvaluatedKey) {
      cmd.input.ExclusiveStartKey = lastEvaluatedKey;
    }

    const resp = await documentClient.send(cmd);
    const newResults = resp.Items || [];
    results.push(...newResults);
    lastEvaluatedKey = resp.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return results;
}

export async function listScansForRepo(repoId: string, startDate: string, endDate: string) {
  const SCANS_TABLE_NAME = scansTableName();

  let lastEvaluatedKey: any;
  const allScans: Scan[] = [];

  do {
    const command = new QueryCommand({
      TableName: SCANS_TABLE_NAME,
      IndexName: 'byTimestampIndex',
      KeyConditionExpression: "repoId = :repoId AND #timestamp BETWEEN :startDate AND :endDate",
      ExpressionAttributeNames: {
        "#timestamp": "timestamp",
      },
      ExpressionAttributeValues: {
        ":repoId": repoId,
        ":startDate": startDate,
        ":endDate": endDate,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const response = await documentClient.send(command);
    allScans.push(...response.Items as Scan[]);
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return allScans;
}
