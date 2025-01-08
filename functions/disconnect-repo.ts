import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import { deleteTenantRepo } from './lib/repos';

type Arguments = {
  provider: 'github';
  providerRepoId: string;
}

export const handler = async (event: AppSyncResolverEvent<Arguments>) => {
  const identity = event.identity as AppSyncIdentityLambda;
  const tenantId = identity.resolverContext.tenantId;

  const { provider, providerRepoId } = event.arguments;
  const repoId = `${provider}#${providerRepoId}`;

  await deleteTenantRepo(tenantId, repoId);
  return true;
}
