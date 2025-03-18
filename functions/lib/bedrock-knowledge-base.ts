import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import {
  BedrockAgentClient,
  CreateDataSourceCommand,
  CreateDataSourceCommandInput,
  CreateKnowledgeBaseCommand,
  CreateKnowledgeBaseCommandInput,
  DataSourceStatus,
  GetDataSourceCommand,
  GetIngestionJobCommand,
  GetKnowledgeBaseCommand,
  KnowledgeBaseStatus,
  StartIngestionJobCommand,
  StartIngestionJobCommandInput,
} from "@aws-sdk/client-bedrock-agent";
import {
  BedrockRuntimeClient,
  RetrieveCommand,
  RetrieveCommandInput,
} from "@aws-sdk/client-bedrock-runtime";
import { callWithRetry, DEFAULT_RETRY_CONFIG } from "./aws-utils";
import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "./errors";

const logger = new Logger({ serviceName: "bedrock-knowledge-base" });
const tracer = new Tracer({ serviceName: "bedrock-knowledge-base" });

// Initialize clients with region parameter for flexibility
const getBedrockClient = (
  region: string = process.env.AWS_REGION || "us-east-1"
) => {
  return tracer.captureAWSv3Client(new BedrockAgentClient({ region }));
};

const getBedrockRuntimeClient = (
  region: string = process.env.AWS_REGION || "us-east-1"
) => {
  return tracer.captureAWSv3Client(new BedrockRuntimeClient({ region }));
};

// Default embedding model ARN with region parameter
const getDefaultEmbeddingModelArn = (
  region: string = process.env.AWS_REGION || "us-east-1"
) => {
  return `arn:aws:bedrock:${region}::foundation-model/amazon.titan-embed-text-v1`;
};

/**
 * Chunking configuration for knowledge base data sources
 */
export interface ChunkingConfig {
  strategy: "FIXED_SIZE" | "HIERARCHICAL" | "NONE";
  maxTokens?: number;
  overlapPercentage?: number;
  hierarchicalLevels?: Array<{
    levelType: "DOCUMENT" | "SEMANTIC" | "PAGE";
    maxTokens: number;
    overlapPercentage: number;
  }>;
}

/**
 * Default fixed-size chunking configuration
 */
export const DEFAULT_FIXED_SIZE_CHUNKING: ChunkingConfig = {
  strategy: "FIXED_SIZE",
  maxTokens: 300,
  overlapPercentage: 10,
};

/**
 * Default hierarchical chunking configuration optimized for code
 */
export const DEFAULT_CODE_CHUNKING: ChunkingConfig = {
  strategy: "HIERARCHICAL",
  hierarchicalLevels: [
    {
      levelType: "DOCUMENT",
      maxTokens: 1000,
      overlapPercentage: 10,
    },
    {
      levelType: "SEMANTIC",
      maxTokens: 300,
      overlapPercentage: 20,
    },
  ],
};

/**
 * Creates a new knowledge base in AWS Bedrock
 *
 * @param tenantId - The tenant ID (organization or user)
 * @param name - The name of the knowledge base
 * @param description - Optional description
 * @param region - AWS region for the Bedrock service
 * @param roleArn - IAM role ARN for the knowledge base
 * @param embeddingModelArn - ARN of the embedding model to use
 * @returns The Bedrock knowledge base ID and status
 */
export async function createBedrockKnowledgeBase(
  tenantId: string,
  name: string,
  description: string = "",
  region: string = process.env.AWS_REGION || "us-east-1",
  roleArn: string = process.env.BEDROCK_KB_ROLE_ARN || "",
  embeddingModelArn: string = getDefaultEmbeddingModelArn(region)
) {
  logger.info("Creating Bedrock knowledge base", { tenantId, name, region });

  if (!roleArn) {
    throw new ValidationError(
      "BEDROCK_KB_ROLE_ARN environment variable is required"
    );
  }

  try {
    const client = getBedrockClient(region);
    const kbName = `${tenantId}-${name}`.substring(0, 100); // Ensure name is within limits

    const params: CreateKnowledgeBaseCommandInput = {
      name: kbName,
      description: description ? description.substring(0, 200) : undefined, // Limit description length
      roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn,
        },
      },
      clientToken: `${tenantId}-${Date.now()}`, // Ensure idempotency
      tags: {
        TenantId: tenantId,
        CreatedAt: new Date().toISOString(),
      },
    };

    const command = new CreateKnowledgeBaseCommand(params);
    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { tenantId, name }
    );

    if (!response.knowledgeBase?.knowledgeBaseId) {
      throw new ServiceUnavailableError(
        "Failed to get knowledge base ID from Bedrock"
      );
    }

    logger.info("Successfully created knowledge base", {
      knowledgeBaseId: response.knowledgeBase?.knowledgeBaseId,
      status: response.knowledgeBase?.status,
    });

    return {
      bedrockKnowledgeBaseId: response.knowledgeBase?.knowledgeBaseId,
      status: response.knowledgeBase?.status,
    };
  } catch (error: any) {
    logger.error("Failed to create knowledge base", {
      error,
      tenantId,
      name,
      region,
    });

    if (error.name === "ThrottlingException") {
      throw new ServiceUnavailableError(
        "Bedrock service is currently throttling requests"
      );
    }

    throw error;
  }
}

/**
 * Creates an S3 data source for a Bedrock knowledge base
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param bucketName - The S3 bucket name
 * @param prefix - The S3 prefix (folder)
 * @param chunkingConfig - Configuration for content chunking
 * @param region - AWS region for the Bedrock service
 * @returns The data source ID and status
 */
export async function createS3DataSource(
  knowledgeBaseId: string,
  bucketName: string,
  prefix: string,
  chunkingConfig: ChunkingConfig = DEFAULT_CODE_CHUNKING,
  region: string = process.env.AWS_REGION || "us-east-1"
) {
  logger.info("Creating S3 data source", {
    knowledgeBaseId,
    bucketName,
    prefix,
    chunkingConfig,
    region,
  });

  try {
    const client = getBedrockClient(region);
    const dataSourceName = `s3-source-${Date.now()}`.substring(0, 100);

    // Construct chunking configuration based on strategy
    let vectorIngestionConfiguration: any = {};

    if (chunkingConfig.strategy === "FIXED_SIZE") {
      vectorIngestionConfiguration = {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: {
            maxTokens: chunkingConfig.maxTokens || 300,
            overlapPercentage: chunkingConfig.overlapPercentage || 10,
          },
        },
      };
    } else if (chunkingConfig.strategy === "HIERARCHICAL") {
      vectorIngestionConfiguration = {
        chunkingConfiguration: {
          chunkingStrategy: "HIERARCHICAL",
          hierarchicalChunkingConfiguration: {
            levelConfigurations: chunkingConfig.hierarchicalLevels?.map(
              (level) => ({
                levelType: level.levelType,
                documentSplitterConfiguration: {
                  maxTokens: level.maxTokens,
                  overlapPercentage: level.overlapPercentage,
                },
              })
            ) || [
              {
                levelType: "DOCUMENT",
                documentSplitterConfiguration: {
                  maxTokens: 1000,
                  overlapPercentage: 10,
                },
              },
              {
                levelType: "SEMANTIC",
                documentSplitterConfiguration: {
                  maxTokens: 300,
                  overlapPercentage: 20,
                },
              },
            ],
          },
        },
      };
    } else {
      // No chunking configuration
      vectorIngestionConfiguration = {};
    }

    const params: CreateDataSourceCommandInput = {
      knowledgeBaseId,
      name: dataSourceName,
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: `arn:aws:s3:::${bucketName}`,
          inclusionPrefixes: [prefix],
        },
      },
      vectorIngestionConfiguration,
      clientToken: `${knowledgeBaseId}-${Date.now()}`, // Ensure idempotency
    };

    const command = new CreateDataSourceCommand(params);
    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { knowledgeBaseId, bucketName, prefix }
    );

    if (!response.dataSource?.dataSourceId) {
      throw new ServiceUnavailableError(
        "Failed to get data source ID from Bedrock"
      );
    }

    logger.info("Successfully created data source", {
      dataSourceId: response.dataSource?.dataSourceId,
      status: response.dataSource?.status,
    });

    return {
      dataSourceId: response.dataSource?.dataSourceId,
      status: response.dataSource?.status,
    };
  } catch (error: any) {
    logger.error("Failed to create data source", {
      error,
      knowledgeBaseId,
      bucketName,
      prefix,
    });

    if (error.name === "ResourceNotFoundException") {
      throw new NotFoundError(
        `Knowledge base with ID ${knowledgeBaseId} not found`
      );
    }

    throw error;
  }
}

/**
 * Starts an ingestion job for a Bedrock knowledge base data source
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param dataSourceId - The data source ID
 * @param region - AWS region for the Bedrock service
 * @returns The ingestion job ID and status
 */
export async function startBedrockIngestionJob(
  knowledgeBaseId: string,
  dataSourceId: string,
  region: string = process.env.AWS_REGION || "us-east-1"
) {
  logger.info("Starting ingestion job", {
    knowledgeBaseId,
    dataSourceId,
    region,
  });

  try {
    const client = getBedrockClient(region);

    const params: StartIngestionJobCommandInput = {
      knowledgeBaseId,
      dataSourceId,
      clientToken: `${knowledgeBaseId}-${dataSourceId}-${Date.now()}`, // Ensure idempotency
    };

    const command = new StartIngestionJobCommand(params);
    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { knowledgeBaseId, dataSourceId }
    );

    if (!response.ingestionJob?.ingestionJobId) {
      throw new ServiceUnavailableError(
        "Failed to get ingestion job ID from Bedrock"
      );
    }

    logger.info("Successfully started ingestion job", {
      ingestionJobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
    });

    return {
      ingestionJobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
    };
  } catch (error: any) {
    logger.error("Failed to start ingestion job", {
      error,
      knowledgeBaseId,
      dataSourceId,
    });

    if (error.name === "ResourceNotFoundException") {
      throw new NotFoundError(`Knowledge base or data source not found`);
    }

    throw error;
  }
}

/**
 * Configuration for knowledge base retrieval
 */
export interface RetrievalConfig {
  maxResults?: number;
  searchType?: "HYBRID" | "SEMANTIC" | "KEYWORD";
  attributeFilter?: Record<string, any>;
  vectorSearchConfiguration?: {
    numberOfResults?: number;
    overrideSearchType?: "HYBRID" | "SEMANTIC" | "KEYWORD";
  };
}

/**
 * Retrieves relevant content from a knowledge base based on a query
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param query - The search query
 * @param config - Retrieval configuration
 * @param region - AWS region for the Bedrock service
 * @returns Array of relevant text snippets with metadata
 */
export async function retrieveFromKnowledgeBase(
  knowledgeBaseId: string,
  query: string,
  config: RetrievalConfig = {},
  region: string = process.env.AWS_REGION || "us-east-1"
): Promise<Array<{ text: string; metadata: any }>> {
  logger.info("Retrieving from knowledge base", {
    knowledgeBaseId,
    query,
    config,
    region,
  });

  try {
    const client = getBedrockRuntimeClient(region);

    const params: RetrieveCommandInput = {
      knowledgeBaseId,
      retrievalQuery: {
        text: query,
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults: config.maxResults || 5,
          overrideSearchType: config.searchType || "HYBRID", // Combines semantic and keyword search
        },
        ...(config.attributeFilter
          ? { attributeFilter: config.attributeFilter }
          : {}),
      },
    };

    const command = new RetrieveCommand(params);
    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { knowledgeBaseId, query }
    );

    const results =
      response.retrievalResults?.map((result) => ({
        text: result.content?.text || "",
        metadata: {
          score: result.score,
          location: result.location,
          metadata: result.metadata,
        },
      })) || [];

    logger.info("Successfully retrieved from knowledge base", {
      resultCount: results.length,
    });

    return results;
  } catch (error: any) {
    logger.error("Failed to retrieve from knowledge base", {
      error,
      knowledgeBaseId,
      query,
    });

    if (error.name === "ResourceNotFoundException") {
      throw new NotFoundError(
        `Knowledge base with ID ${knowledgeBaseId} not found`
      );
    }

    throw error;
  }
}

/**
 * Checks the status of a knowledge base
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param region - AWS region for the Bedrock service
 * @returns The knowledge base status and metadata
 */
export async function getKnowledgeBaseStatus(
  knowledgeBaseId: string,
  region: string = process.env.AWS_REGION || "us-east-1"
) {
  logger.info("Getting knowledge base status", { knowledgeBaseId, region });

  try {
    const client = getBedrockClient(region);
    const command = new GetKnowledgeBaseCommand({ knowledgeBaseId });

    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { knowledgeBaseId }
    );

    return {
      knowledgeBaseId: response.knowledgeBase?.knowledgeBaseId,
      status: response.knowledgeBase?.status,
      createdAt: response.knowledgeBase?.createdAt,
      updatedAt: response.knowledgeBase?.updatedAt,
      isAvailable:
        response.knowledgeBase?.status === KnowledgeBaseStatus.AVAILABLE,
    };
  } catch (error: any) {
    logger.error("Failed to get knowledge base status", {
      error,
      knowledgeBaseId,
    });

    if (error.name === "ResourceNotFoundException") {
      throw new NotFoundError(
        `Knowledge base with ID ${knowledgeBaseId} not found`
      );
    }

    throw error;
  }
}

/**
 * Checks the status of a data source
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param dataSourceId - The data source ID
 * @param region - AWS region for the Bedrock service
 * @returns The data source status and metadata
 */
export async function getDataSourceStatus(
  knowledgeBaseId: string,
  dataSourceId: string,
  region: string = process.env.AWS_REGION || "us-east-1"
) {
  logger.info("Getting data source status", {
    knowledgeBaseId,
    dataSourceId,
    region,
  });

  try {
    const client = getBedrockClient(region);
    const command = new GetDataSourceCommand({ knowledgeBaseId, dataSourceId });

    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { knowledgeBaseId, dataSourceId }
    );

    return {
      knowledgeBaseId: response.dataSource?.knowledgeBaseId,
      dataSourceId: response.dataSource?.dataSourceId,
      status: response.dataSource?.status,
      createdAt: response.dataSource?.createdAt,
      updatedAt: response.dataSource?.updatedAt,
      isAvailable: response.dataSource?.status === DataSourceStatus.AVAILABLE,
    };
  } catch (error: any) {
    logger.error("Failed to get data source status", {
      error,
      knowledgeBaseId,
      dataSourceId,
    });

    if (error.name === "ResourceNotFoundException") {
      throw new NotFoundError(`Knowledge base or data source not found`);
    }

    throw error;
  }
}

/**
 * Checks the status of an ingestion job
 *
 * @param knowledgeBaseId - The Bedrock knowledge base ID
 * @param dataSourceId - The data source ID
 * @param ingestionJobId - The ingestion job ID
 * @param region - AWS region for the Bedrock service
 * @returns The ingestion job status and metadata
 */
export async function getIngestionJobStatus(
  knowledgeBaseId: string,
  dataSourceId: string,
  ingestionJobId: string,
  region: string = process.env.AWS_REGION || "us-east-1"
) {
  logger.info("Getting ingestion job status", {
    knowledgeBaseId,
    dataSourceId,
    ingestionJobId,
    region,
  });

  try {
    const client = getBedrockClient(region);
    const command = new GetIngestionJobCommand({
      knowledgeBaseId,
      dataSourceId,
      ingestionJobId,
    });

    const response = await callWithRetry(
      client,
      "send",
      command,
      DEFAULT_RETRY_CONFIG,
      { knowledgeBaseId, dataSourceId, ingestionJobId }
    );

    return {
      knowledgeBaseId: response.ingestionJob?.knowledgeBaseId,
      dataSourceId: response.ingestionJob?.dataSourceId,
      ingestionJobId: response.ingestionJob?.ingestionJobId,
      status: response.ingestionJob?.status,
      statistics: response.ingestionJob?.statistics,
      startedAt: response.ingestionJob?.startedAt,
      completedAt: response.ingestionJob?.completedAt,
      failureReasons: response.ingestionJob?.failureReasons,
      downloadUrl: response.downloadUrl,
    };
  } catch (error: any) {
    logger.error("Failed to get ingestion job status", {
      error,
      knowledgeBaseId,
      dataSourceId,
      ingestionJobId,
    });

    if (error.name === "ResourceNotFoundException") {
      throw new NotFoundError(
        `Knowledge base, data source, or ingestion job not found`
      );
    }

    throw error;
  }
}
