import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import { listReposForTenant } from './lib/repos';
import { listScansForRepo } from './lib/scans';
import * as _ from 'lodash';
import { Sema } from "async-sema";
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();

type Arguments = {
  startDate: string;
  endDate: string;
}

type Datum = {
  scans: number
  filesScanned: number
  allIssues: number
  critical: number
  high: number
  medium: number
  low: number
  repos: number
}

// allow 50 concurrent requests for listScansForRepo
const listScansSema = new Sema(50, {
  capacity: 1000
});

// What we're doing here is rather brute force and inefficient.
// TODO: refactor this function to use a time series DB such as Timestream.
export const handler = async (event: AppSyncResolverEvent<Arguments>) => {
  const { startDate, endDate } = event.arguments;
  const identity = event.identity as AppSyncIdentityLambda;
  const tenantRepos = await listReposForTenant(identity.resolverContext.tenantId);
  
  const promises = tenantRepos.map(async (repo) => {
    await listScansSema.acquire();

    try {
      return listScansForRepo(repo.repoId, startDate, endDate);
    } catch (error) {
      logger.warn('Error listing scans for repo', { 
        repoId: repo.repoId,
        repoName: repo.fullName,
        error
      });

      return [];
    } finally {
      listScansSema.release();
    }
  })
  
  const allScans = (await Promise.all(promises)).flat();

  // group scans by date (YYYY-MM-DD)
  const groupByDate = _.groupBy(allScans, (scan) => scan.timestamp.slice(0, 10));
  const dailyStats = Object.entries(groupByDate).map(([date, scans]) => {
    const filesScanned = scans.reduce((acc, scan) => acc + scan.filesScanned, 0);
    const allIssues = scans.reduce((acc, scan) => acc + scan.issuesCount, 0);
    const critical = scans.reduce((acc, scan) => acc + scan.critical, 0);
    const high = scans.reduce((acc, scan) => acc + scan.high, 0);
    const medium = scans.reduce((acc, scan) => acc + scan.medium, 0);
    const low = scans.reduce((acc, scan) => acc + scan.low, 0);
    const repos = _.uniq(scans.map((scan) => scan.repoId)).length;

    const data: Datum = {
      scans: scans.length,
      filesScanned,
      allIssues,
      critical,
      high,
      medium,
      low,
      repos
    };

    return { date, data }
  });

  const total: Datum = {
    scans: allScans.length,
    filesScanned: _.sumBy(allScans, 'filesScanned'),
    allIssues: _.sumBy(allScans, 'issuesCount'),
    critical: _.sumBy(allScans, 'critical'),
    high: _.sumBy(allScans, 'high'),
    medium: _.sumBy(allScans, 'medium'),
    low: _.sumBy(allScans, 'low'),
    repos: _.uniq(allScans.map((scan) => scan.repoId)).length
  }

  return {
    total,
    dailyStats
  }
}
