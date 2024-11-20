import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { createNextToken, parseNextToken } from './lib/search';
import { initSearchClient, tenantReposIndexName } from './lib/algolia';
import { TenantRepo, batchGetRepos } from './lib/repos';

const { SSM_STAGE_NAME } = process.env;

const logger = new Logger();

type Arguments = {
  query: string
  count: number
  sortBy: "lastReviewedAt"
  sortDirection: "asc" | "desc"
  nextToken?: string
}

const _handler = async (event: AppSyncResolverEvent<Arguments>, context: any) => {
  if (event.arguments.count > 100) {
    throw new Error('"count" cannot be greater than 100');
  }

  const { ALGOLIA_APP_ID, ALGOLIA_API_KEY } = context;
  const algolia = await initSearchClient(ALGOLIA_APP_ID, ALGOLIA_API_KEY);

  const searchParams = parseNextToken(event.arguments.nextToken) || {
    query: event.arguments.query,
    sortBy: event.arguments.sortBy,
    sortDirection: event.arguments.sortDirection,
    count: event.arguments.count,
  };

  logger.debug('Search params', { searchParams });

  const indexName = tenantReposIndexName(searchParams.sortBy, searchParams.sortDirection);
  const identity = event.identity as AppSyncIdentityLambda;

  const resp = await algolia.search({
    requests: [{
      indexName,
      query: searchParams.query,
      hitsPerPage: searchParams.count,
      page: searchParams.page,
      facetFilters: [`tenantId:${identity.resolverContext.tenantId}`]      
    }]
  })

  const result = resp.results[0] as any;
  const { hits, page, nbPages } = result;
  const tenantRepos = hits as (TenantRepo & { enabled?: boolean })[];

  if (tenantRepos.length > 0) {
    const repoIds = tenantRepos.map(x => x.repoId);
    const repos = await batchGetRepos(repoIds);
    for (const tenantRepo of tenantRepos) {
      const repo = repos.find(x => tenantRepo.repoId === x.repoId);
      if (repo) {
        tenantRepo.enabled = true;
      } else {
        tenantRepo.enabled = false;
      }
    }
  }

  const _nextToken = nbPages > (page + 1) 
    ? createNextToken({ ...searchParams, page: page + 1 })
    : undefined;

  return {
    repos: tenantRepos,
    nextToken: _nextToken
  };
}

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      ALGOLIA_APP_ID: `/evolua/${SSM_STAGE_NAME}/algolia/app-id`,
      ALGOLIA_API_KEY: `/evolua/${SSM_STAGE_NAME}/algolia/search-api-key`,
    }
  }));