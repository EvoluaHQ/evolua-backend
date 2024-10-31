import { DynamoDB } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import * as ulid from 'ulid';

const dynamodbClient = new DynamoDB();
const DocumentClient = DynamoDBDocumentClient.from(dynamodbClient);

// DynamoDB's batch operations also allow this many items in a batch
const BATCH_SIZE = 25;

const SCANS_TABLE_NAME = process.env.SCANS_TABLE_NAME || '';
if (!SCANS_TABLE_NAME) {
  throw new Error('SCANS_TABLE_NAME env var is missing');
}

interface Issue {
  type: string,
  title: string,
  severity: string,
  location: {
    start: number,
    end: number,
  },
  description: string,
  impact: string,
  recommendation: string,
  cwe: string  
}

interface Summary {
  issues: number,
  risks: {
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
  id: string;
  number: number;
  url: string;
  title: string;
  createdAt: string;
}

export async function saveScanResults(repoId: string, pr: PullRequest, results: ScanResult[]) {
  const timestamp = new Date().toISOString();
  const prId = pr.id;
  const scanId = ulid.ulid();

  const countIssues = (f: (summary: Summary) => number) => {
    return results.reduce((acc, result) => acc + f(result.summary), 0);
  } 

  const saveScanReq = {
    PutRequest: {
      Item: {
        repoId,
        sk: `PR#${prId}#SUMMARY#${scanId}`,
        scanId,
        type: 'SUMMARY',
        timestamp,
        pullRequest: pr,
        filesScanned: results.length,
        issuesCount: countIssues((summary) => summary.issues),
        critical: countIssues((summary) => summary.risks.critical),
        high: countIssues((summary) => summary.risks.high),
        medium: countIssues((summary) => summary.risks.medium),
        low: countIssues((summary) => summary.risks.low)
      }
    }
  }

  const saveResultsReqs = results.map(result => ({
    PutRequest: {
      Item: {
        repoId,
        sk: `PR#${prId}#RESULT#${scanId}#${result.file}`,
        scanId,
        type: 'RESULT',
        file: result.file,
        timestamp,
        changes: {
          additions: result.additions,
          deletions: result.deletions,
          changeType: result.changeType,
          sha: result.sha
        },
        issuesCount: result.summary.issues,
        critical: result.summary.risks.critical,
        high: result.summary.risks.high,
        medium: result.summary.risks.medium,
        low: result.summary.risks.low,
        issues: result.issues
      }
    }
  }));

  const allRequests = [saveScanReq, ...saveResultsReqs];
  const batches = [];

  for (let i = 0; i < allRequests.length; i += BATCH_SIZE) {
    const requests = allRequests.slice(i, i + BATCH_SIZE);
    const batch = DocumentClient.send(new BatchWriteCommand({
      RequestItems: {
        [SCANS_TABLE_NAME]: requests
      }
    }));
    batches.push(batch);
  }

  await Promise.all(batches);
}
