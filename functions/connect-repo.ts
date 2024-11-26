import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { initClerk, getUserMetadata } from './lib/clerk';
import { getUserPermissions } from './lib/github-helper';
import { getRepo, enableReposForTenant } from './lib/repos';

const { SSM_STAGE_NAME } = process.env;

const logger = new Logger();

type Arguments = {
  provider: "github" // only github is supported for now
  providerRepoId: string
}

const _handler = async (event: AppSyncResolverEvent<Arguments>, context: any) => {
  initClerk(context.CLERK_SECRET_KEY);

  const identity = event.identity as AppSyncIdentityLambda;
  const metadata = await getUserMetadata(identity.resolverContext.clerkUserId);
  if (!metadata.githubAccessToken) {
    throw new Error("GitHub access token not found.");
  }

  const ghRepoId = parseInt(event.arguments.providerRepoId);
  const permissions = await getUserPermissions(metadata.githubAccessToken, ghRepoId);

  logger.debug('Found user permissions', { 
    tenantId: identity.resolverContext.tenantId,
    gitHubRepoId: ghRepoId,
    permissions
  });
  
  if (permissions.admin !== true) {
    throw new Error("You need to have admin access to the repo to perform this action.");
  }

  const repoId = `github#${ghRepoId}`;
  const repo = await getRepo(repoId);

  if (!repo) {
    throw new Error("Repo not found.");
  }

  await enableReposForTenant(identity.resolverContext.tenantId, [repo]);

  return true;
}

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      CLERK_SECRET_KEY: `/evolua/${SSM_STAGE_NAME}/clerk/secret-key`,
    }
  }));
