import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { getTenantRepo, deleteTenantRepo } from './lib/repos';

const logger = new Logger();

type Arguments = {
  tenantRepoId: string
}

export const handler = async (event: AppSyncResolverEvent<Arguments>) => {
  const identity = event.identity as AppSyncIdentityLambda;
  const tenantId = identity.resolverContext.tenantId;

  const tenantRepo = await getTenantRepo(tenantId, event.arguments.tenantRepoId);
  if (!tenantRepo) {
    logger.warn('Tenant repo not found', { 
      tenantId, 
      tenantRepoId: event.arguments.tenantRepoId
    });

    return true;
  }

  await deleteTenantRepo(tenantId, tenantRepo.repoId);
  return true;
}
