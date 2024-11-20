import { EventBridgeEvent } from 'aws-lambda';
import { EventEnvelope, ScanCompletedEventDetail } from "./types";
import { findTenantReposByRepoId, batchUpdateTenantRepoLastReviewedAt } from './lib/repos';

type Event = EventBridgeEvent<'scan_triggered', EventEnvelope<ScanCompletedEventDetail>>;

export const handler = async (event: Event, context: any) => {
  const repoId = event.detail.data.repoId;
  const lastReviewedAt = event.detail.data.reviewedAt;
  
  const tenantRepos = await findTenantReposByRepoId(repoId);
  const tenantIds = tenantRepos.map(x => x.tenantId);
  await batchUpdateTenantRepoLastReviewedAt(repoId, tenantIds, lastReviewedAt);
};
