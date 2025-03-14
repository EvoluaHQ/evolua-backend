import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
  BedrockAgentClient,
  CreateDataSourceCommand,
  CreateDataSourceCommandInput,
  CreateKnowledgeBaseCommand,
  CreateKnowledgeBaseCommandInput,
  GetDataSourceCommand,
  GetIngestionJobCommand,
  GetKnowledgeBaseCommand,
  StartIngestionJobCommand,
  StartIngestionJobCommandInput,
} from "@aws-sdk/client-bedrock-agent";
import {
  BedrockRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from "@aws-sdk/client-bedrock-runtime";

const logger = new Logger({ serviceName: "bedrock-knowledge-base" });
const tracer = new Tracer();

// Initialize clients
const bedrockClient = tracer.captureAWSv3Client(new BedrockAgentClient());
const bedrockRuntimeClient = tracer.captureAWSv3Client(
  new BedrockRuntimeClient()
);

/**
 * Creates a new knowledge base in AWS Bedrock
 *
 * @param name - The name of the knowledge base
 * @param description - Optional description
 * @param tenantId - The tenant ID (organization or user)
 * @returns The Bedrock knowledge base ID and status
 */
export async function createBedrockKnowledgeBase(
  name: string,
  description: string,
  tenantId: string
) {
  logger.info("Creating Bedrock knowledge base", { name, tenantId });

  try {
    const params: CreateKnowledgeBaseCommandInput = {
      name: `${tenantId}-${name}`.substring(0, 100), // Ensure name is within limits
      description: description ? description.substring(0, 200) : undefined, // Limit description length
      roleArn: process.env.BEDROCK_KB_ROLE_ARN,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn:
            "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v1",
        },
      },
    };

    const command = new CreateKnowledgeBaseCommand(params);
    const response = await bedrockClient.send(command);

    logger.info("Successfully created knowledge base", {
      knowledgeBaseId: response.knowledgeBase?.knowledgeBaseId,
      status: response.knowledgeBase?.status,
    });

    return {
      bedrockKnowledgeBaseId: response.knowledgeBase?.knowledgeBaseId,
      status: response.knowledgeBase?.status,
    };
  } catch (error) {
    logger.error("Failed to create knowledge base", { error });
    throw error;
  }
}

/**
 * Creates an S3 data source for a Bedrock knowledge base
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param bucketName - The S3 bucket name
 * @param prefix - The S3 prefix (folder)
 * @returns The data source ID and status
 */
export async function createS3DataSource(
  knowledgeBaseId: string,
  bucketName: string,
  prefix: string
) {
  logger.info("Creating S3 data source", {
    knowledgeBaseId,
    bucketName,
    prefix,
  });

  try {
    const params: CreateDataSourceCommandInput = {
      knowledgeBaseId: knowledgeBaseId,
      name: `s3-source-${Date.now()}`.substring(0, 100),
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: `arn:aws:s3:::${bucketName}`,
          inclusionPrefixes: [prefix],
        },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "HIERARCHICAL", // Better for code repositories
          hierarchicalChunkingConfiguration: {
            levelConfigurations: [
              {
                documentSplitterConfiguration: {
                  maxTokens: 1000,
                  overlapPercentage: 10,
                },
                levelType: "DOCUMENT",
              },
              {
                documentSplitterConfiguration: {
                  maxTokens: 300,
                  overlapPercentage: 20,
                },
                levelType: "SEMANTIC",
              },
            ],
          },
        },
      },
    };

    const command = new CreateDataSourceCommand(params);
    const response = await bedrockClient.send(command);

    logger.info("Successfully created data source", {
      dataSourceId: response.dataSource?.dataSourceId,
      status: response.dataSource?.status,
    });

    return {
      dataSourceId: response.dataSource?.dataSourceId,
      status: response.dataSource?.status,
    };
  } catch (error) {
    logger.error("Failed to create data source", { error, knowledgeBaseId });
    throw error;
  }
}

/**
 * Starts an ingestion job for a Bedrock knowledge base data source
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param dataSourceId - The data source ID
 * @returns The ingestion job ID and status
 */
export async function startBedrockIngestionJob(
  knowledgeBaseId: string,
  dataSourceId: string
) {
  logger.info("Starting ingestion job", { knowledgeBaseId, dataSourceId });

  try {
    const params: StartIngestionJobCommandInput = {
      knowledgeBaseId,
      dataSourceId,
    };

    const command = new StartIngestionJobCommand(params);
    const response = await bedrockClient.send(command);

    logger.info("Successfully started ingestion job", {
      ingestionJobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
    });

    return {
      ingestionJobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
    };
  } catch (error) {
    logger.error("Failed to start ingestion job", {
      error,
      knowledgeBaseId,
      dataSourceId,
    });
    throw error;
  }
}

/**
 * Retrieves relevant content from a knowledge base based on a query
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param query - The search query
 * @param maxResults - Maximum number of results to return
 * @returns Array of relevant text snippets
 */
export async function retrieveFromKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  maxResults: number = 5
): Promise<string[]> {
  logger.info("Retrieving from knowledge base", {
    knowledgeBaseId,
    query,
    maxResults,
  });

  try {
    const params: RetrieveCommandInput = {
      knowledgeBaseId: knowledgeBaseId,
      retrievalQuery: {
        text: query,
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: maxResults,
          overrideSearchType: "HYBRID", // Combines semantic and keyword search
        },
      },
    };

    const command = new RetrieveCommand(params);
    const response = await bedrockRuntimeClient.send(command);

    const results =
      response.retrievalResults?.map((result) => result.content?.text || "") ||
      [];

    logger.info("Successfully retrieved from knowledge base", {
      resultCount: results.length,
    });

    return results;
  } catch (error) {
    logger.error("Failed to retrieve from knowledge base", {
      error,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Checks the status of a knowledge base
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @returns The knowledge base status
 */
export async function getKnowledgeBaseStatus(knowledgeBaseId: string) {
  logger.info("Getting knowledge base status", { knowledgeBaseId });

  try {
    const command = new GetKnowledgeBaseCommand({ knowledgeBaseId });
    const response = await bedrockClient.send(command);

    return {
      status: response.knowledgeBase?.status,
      createdAt: response.knowledgeBase?.createdAt,
      updatedAt: response.knowledgeBase?.updatedAt,
    };
  } catch (error) {
    logger.error("Failed to get knowledge base status", {
      error,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Checks the status of a data source
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param dataSourceId - The data source ID
 * @returns The data source status
 */
export async function getDataSourceStatus(
  knowledgeBaseId: string,
  dataSourceId: string
) {
  logger.info("Getting data source status", { knowledgeBaseId, dataSourceId });

  try {
    const command = new GetDataSourceCommand({ knowledgeBaseId, dataSourceId });
    const response = await bedrockClient.send(command);

    return {
      status: response.dataSource?.status,
      createdAt: response.dataSource?.createdAt,
      updatedAt: response.dataSource?.updatedAt,
    };
  } catch (error) {
    logger.error("Failed to get data source status", {
      error,
      knowledgeBaseId,
      dataSourceId,
    });
    throw error;
  }
}

/**
 * Checks the status of an ingestion job
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param dataSourceId - The data source ID
 * @param ingestionJobId - The ingestion job ID
 * @returns The ingestion job status
 */
export async function getIngestionJobStatus(
  knowledgeBaseId: string,
  dataSourceId: string,
  ingestionJobId: string
) {
  logger.info("Getting ingestion job status", {
    knowledgeBaseId,
    dataSourceId,
    ingestionJobId,
  });

  try {
    const command = new GetIngestionJobCommand({
      knowledgeBaseId,
      dataSourceId,
      ingestionJobId,
    });

    const response = await bedrockClient.send(command);

    return {
      status: response.ingestionJob?.status,
      statistics: response.ingestionJob?.statistics,
      startedAt: response.ingestionJob?.startedAt,
      completedAt: response.ingestionJob?.completedAt,
      failureReasons: response.ingestionJob?.failureReasons,
    };
  } catch (error) {
    logger.error("Failed to get ingestion job status", {
      error,
      knowledgeBaseId,
      dataSourceId,
      ingestionJobId,
    });
    throw error;
  }
}
