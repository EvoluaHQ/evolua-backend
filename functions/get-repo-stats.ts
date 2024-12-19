import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import { getTenantRepo } from './lib/repos';
import { listScansForRepo } from './lib/scans';
import * as _ from 'lodash';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();

type Arguments = {
  startDate: string;
  endDate: string;
  tenantRepoId: string;
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

// What we're doing here is rather brute force and inefficient.
// TODO: refactor this function to use a time series DB such as Timestream.
export const handler = async (event: AppSyncResolverEvent<Arguments>) => {
  const { tenantRepoId, startDate, endDate } = event.arguments;
  // end date is exclusive, we want to make it inclusive, so let's add one day to it
  // end date is in 'YYYY-MM-DD' format, so this needs to stay the same format
  const endDateInclusive = new Date(endDate);
  endDateInclusive.setUTCDate(endDateInclusive.getUTCDate() + 1);
  const formattedEndDate = endDateInclusive.toISOString().slice(0, 10);

  const identity = event.identity as AppSyncIdentityLambda;
  const tenantRepo = await getTenantRepo(
    identity.resolverContext.tenantId,
    tenantRepoId
  );
  
  if (!tenantRepo) {
    logger.warn('Tenant repo not found', { tenantRepoId });
    return null;
  }
  
  const allScans = await listScansForRepo(tenantRepo.repoId, startDate, formattedEndDate);

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
