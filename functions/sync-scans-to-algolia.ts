import { unmarshall } from "@aws-sdk/util-dynamodb";
import middy from "@middy/core";
import ssm from "@middy/ssm";
import { initScansIndex, scansIndexName, BatchRequest } from "./lib/algolia";
import { getScanResults } from "./lib/scans";

const { SSM_STAGE_NAME } = process.env;

const _handler = async (event: any, context: any) => {
  const index = await initScansIndex(
    context.ALGOLIA_APP_ID, context.ALGOLIA_API_KEY)

  const indexName = scansIndexName()
  
  const requests: BatchRequest[] = []

  for (const record of event.Records) {
    if (record.eventName === "INSERT" || record.eventName === "MODIFY") {
      const scan = unmarshall(record.dynamodb.NewImage)
      
      scan.objectID = scan.scanId
      const scanResults = await getScanResults(scan.scanId)
      // we can't save the whole result in Algolia because it'd be too big
      // so we just save the file names which are searchable
      scan.reviewedFiles = scanResults.map((result) => result.file)

      requests.push({
        action: "addObject",
        body: scan
      })
    } else if (record.eventName === "REMOVE") {
      const scan = unmarshall(record.dynamodb.OldImage)

      requests.push({
        action: "deleteObject",
        body: {
          objectID: scan.scanId
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
