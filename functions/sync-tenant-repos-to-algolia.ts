import { unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import ssm from "@middy/ssm";
import { initTenantReposIndex, tenantReposIndexName, BatchRequest } from "./lib/algolia";

const { SSM_STAGE_NAME } = process.env;

const _handler = async (event: any, context: any) => {
  const index = await initTenantReposIndex(
    context.ALGOLIA_APP_ID, context.ALGOLIA_API_KEY)

  const indexName = tenantReposIndexName()
  
  const requests: BatchRequest[] = []

  for (const record of event.Records) {
    if (record.eventName === "INSERT" || record.eventName === "MODIFY") {
      const tenantRepo = unmarshall(record.dynamodb.NewImage)
      
      tenantRepo.objectID = tenantRepo.repoId

      requests.push({
        action: "addObject",
        body: tenantRepo
      })
    } else if (record.eventName === "REMOVE") {
      const tenantRepo = unmarshall(record.dynamodb.OldImage)

      requests.push({
        action: "deleteObject",
        body: {
          objectID: tenantRepo.repoId
        }
      })
    }
  }

  await index.batch({
    indexName,
    batchWriteParams: {
      requests,
    }
  })
};

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      ALGOLIA_APP_ID: `/evolua/${SSM_STAGE_NAME}/algolia/app-id`,
      ALGOLIA_API_KEY: `/evolua/${SSM_STAGE_NAME}/algolia/write-api-key`,
    }
  }));
