import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import * as ulid from 'ulid';
import * as helper from './dynamodb-helper';

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

const SCANS_TABLE_NAME = process.env.SCANS_TABLE_NAME || '';
const SCAN_RESULTS_TABLE_NAME = process.env.SCAN_RESULTS_TABLE_NAME || '';

if (!SCANS_TABLE_NAME) {
  throw new Error('SCANS_TABLE_NAME env var is missing');
}

if (!SCAN_RESULTS_TABLE_NAME) {
  throw new Error('SCAN_RESULTS_TABLE_NAME env var is missing');
}

interface Issue {
  id: string,
  type: string,
  title: string,
  risk_level: string,
  location: {
    line_start: number,
    line_end: number,
  },
  description?: string,
  impact?: string,
  recommendation: string,
  cwe_id?: string,
  references: {
    standard?: string,
    rule_id?: string,
  }
}

interface Summary {
  total_issues: number,
  risk_levels: {
    critical: number,
    high: number,
    medium: number,
    low: number
  }
}

interface ScanResult {
  file: string;
  additions: number;
  deletions: number;
  changeType: string;
  sha: string;
  summary: Summary,
  issues: Issue[]
}

interface PullRequest {
  id: number;
  number: number;
  url: string;
  title: string;
  createdAt: string;
}

export async function saveScanResults(repoId: string, pr: PullRequest, results: ScanResult[]) {
  const timestamp = new Date().toISOString();
  const prId = pr.id.toString();
  const scanId = ulid.ulid();

  const countIssues = (f: (summary: Summary) => number) => {
    return results.reduce((acc, result) => acc + f(result.summary), 0);
  }

  await DocumentClient.send(new PutCommand({
    TableName: SCANS_TABLE_NAME,
    Item: {
      repoId,
      scanId,
      timestamp,
      pullRequestId: prId,
      pullRequest: {
        id: prId,
        number: pr.number,
        url: pr.url,
        title: pr.title,
        createdAt: pr.createdAt
      },
      filesScanned: results.length,
      issuesCount: countIssues((summary) => summary.total_issues),
      critical: countIssues((summary) => summary.risk_levels.critical),
      high: countIssues((summary) => summary.risk_levels.high),
      medium: countIssues((summary) => summary.risk_levels.medium),
      low: countIssues((summary) => summary.risk_levels.low)
    }
  }));

  const saveResultsReqs = results.map(result => ({
    PutRequest: {
      Item: {
        scanId,
        file: result.file,
        timestamp,
        changes: {
          additions: result.additions,
          deletions: result.deletions,
          changeType: result.changeType,
          sha: result.sha
        },
        issuesCount: result.summary.total_issues,
        critical: result.summary.risk_levels.critical,
        high: result.summary.risk_levels.high,
        medium: result.summary.risk_levels.medium,
        low: result.summary.risk_levels.low,
        issues: result.issues
      }
    }
  }));

  await helper.executeBatchWriteCommand(DocumentClient, SCAN_RESULTS_TABLE_NAME, saveResultsReqs);
}
