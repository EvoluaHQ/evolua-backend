import { searchClient, BatchRequest as AlgoliaBatchRequest } from "@algolia/client-search";

export type BatchRequest = AlgoliaBatchRequest

export const tenantReposIndexName = () => {
  if (!process.env.STAGE_NAME) {
    throw new Error("STAGE_NAME env var is not set");
  }

  return `tenant-repos-${process.env.STAGE_NAME}`;
}

export const scansIndexName = () => {
  if (!process.env.STAGE_NAME) {
    throw new Error("STAGE_NAME env var is not set");
  }

  return `scans-${process.env.STAGE_NAME}`;
}

export const initSearchClient = (appId: string, apiKey: string) => {
  const client = searchClient(appId, apiKey)
  return client
}

export const initTenantReposIndex = async (appId: string, apiKey: string) => {
  const indexName = tenantReposIndexName()

  const client = searchClient(appId, apiKey)

  await client.setSettings({
    indexName,
    indexSettings: {
      searchableAttributes: [
        "name",
        "fullName",
      ],
      attributesForFaceting: [
        "provider",
        "private",
        "tenantId",
      ],
      customRanking: [
        "desc(lastReviewedAt)"
      ],
      replicas: [
        `${indexName}-asc-lastReviewedAt`,
      ]
    },
    forwardToReplicas: true
  })

  // replica setting
  await client.setSettings({
    indexName: `${indexName}-asc-lastReviewedAt`,
    indexSettings: {
      searchableAttributes: [
        "name",
        "fullName",
      ],
      attributesForFaceting: [
        "provider",
        "private",
        "tenantId",
      ],
      customRanking: [
        "asc(lastReviewedAt)"
      ]
    }
  })

  return client
}

export const initScansIndex = async (appId: string, apiKey: string) => {
  const indexName = scansIndexName()

  const client = searchClient(appId, apiKey)    
  await client.setSettings({
    indexName,
    indexSettings: {
      searchableAttributes: [
        "pullRequest.title",
        "reviewedFiles",
      ],
      attributesForFaceting: [
        "repoId"
      ],
      customRanking: [
        "desc(pullRequest.createdAt)"
      ],
    }
  })

  return client
}
