import { AppSyncResolverEvent, AppSyncIdentityLambda } from 'aws-lambda';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import { Logger } from '@aws-lambda-powertools/logger';
import { createNextToken, parseNextToken } from './lib/search';
import { initSearchClient, scansIndexName } from './lib/algolia';
import { getTenantRepo } from './lib/repos';
import { Scan } from './lib/scans';

const { SSM_STAGE_NAME } = process.env;

const logger = new Logger();

type Arguments = {
  tenantRepoId: string
  query: string
  count: number
  nextToken?: string
}

const _handler = async (event: AppSyncResolverEvent<Arguments>, context: any) => {
  if (event.arguments.count > 100) {
    throw new Error('"count" cannot be greater than 100');
  }

  const identity = event.identity as AppSyncIdentityLambda;
  const tenantId = identity.resolverContext.tenantId;

  const searchParams = parseNextToken(event.arguments.nextToken) || {
    tenantRepoId: event.arguments.tenantRepoId,
    query: event.arguments.query,
    count: event.arguments.count,
  };

  const tenantRepo = await getTenantRepo(tenantId, searchParams.tenantRepoId);
  if (!tenantRepo) {
    throw new Error('Tenant repo not found');
  }

  const { ALGOLIA_APP_ID, ALGOLIA_API_KEY } = context;
  const algolia = await initSearchClient(ALGOLIA_APP_ID, ALGOLIA_API_KEY);  

  logger.debug('Search params', { searchParams });

  const indexName = scansIndexName();

  const resp = await algolia.search({
    requests: [{
      indexName,
      query: searchParams.query,
      hitsPerPage: searchParams.count,
      page: searchParams.page,
      facetFilters: [`repoId:${tenantRepo.repoId}`]      
    }]
  })

  const result = resp.results[0] as any;
  const { hits, page, nbPages } = result;
  const scans = hits as Scan[];  

  const _nextToken = nbPages > (page + 1) 
    ? createNextToken({ ...searchParams, page: page + 1 })
    : undefined;

  return {
    scans: scans,
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