import { EventBridgeEvent } from 'aws-lambda';
import { EventEnvelope, ScanCompletedEventDetail } from "./types";
import { findTenantReposByRepoId, updateTenantRepoLastReviewedAt } from './lib/repos';

type Event = EventBridgeEvent<'scan_triggered', EventEnvelope<ScanCompletedEventDetail>>;

export const handler = async (event: Event, context: any) => {
  const repoId = event.detail.data.repoId;
  const lastReviewedAt = event.detail.data.reviewedAt;
  
  const tenantRepos = await findTenantReposByRepoId(repoId);
  for (const tenantRepo of tenantRepos) {
    await updateTenantRepoLastReviewedAt(
      tenantRepo.tenantId,
      tenantRepo.repoId,
      lastReviewedAt);
  }
};
