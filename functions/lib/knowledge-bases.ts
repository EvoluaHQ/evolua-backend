import { Logger } from "@aws-lambda-powertools/logger";
import {
  DeleteCommand,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  QueryCommand,
  QueryCommandOutput,
  UpdateCommand,
  UpdateCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBaseIngestionJob,
} from "../types/knowledge-base";
import { callWithRetry, DEFAULT_RETRY_CONFIG } from "./aws-utils";
import { createBedrockKnowledgeBase } from "./bedrock-knowledge-base";
import {
  documentClient,
  knowledgeBaseDocumentsTableName,
  knowledgeBaseIngestionJobsTableName,
  knowledgeBasesTableName,
} from "./dynamodb-helper";
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "./errors";
import {
  recordKnowledgeBaseMetric,
  reportDocumentProcessing,
  trackPerformance,
} from "./monitoring";

const logger = new Logger({ serviceName: "knowledge-bases" });

/**
 * Creates a new knowledge base
 *
 * @param knowledgeBase - The knowledge base to create
 * @returns The created knowledge base
 * @throws ValidationError if knowledgeBase data is invalid
 * @throws ConflictError if knowledge base already exists
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function createKnowledgeBase(
  knowledgeBase: KnowledgeBase
): Promise<KnowledgeBase> {
  // Validate required fields
  if (
    !knowledgeBase.tenantId ||
    !knowledgeBase.knowledgeBaseId ||
    !knowledgeBase.name
  ) {
    throw new ValidationError("Missing required fields", {
      requiredFields: ["tenantId", "knowledgeBaseId", "name"],
    });
  }

  return trackPerformance(
    knowledgeBase.tenantId,
    "createKnowledgeBase",
    async () => {
      logger.info("Creating knowledge base", {
        tenantId: knowledgeBase.tenantId,
        knowledgeBaseId: knowledgeBase.knowledgeBaseId,
        name: knowledgeBase.name,
      });

      try {
        // Check if knowledge base already exists
        const existingKB = await getKnowledgeBase(
          knowledgeBase.tenantId,
          knowledgeBase.knowledgeBaseId
        );

        if (existingKB) {
          throw new ConflictError("Knowledge base already exists", {
            tenantId: knowledgeBase.tenantId,
            knowledgeBaseId: knowledgeBase.knowledgeBaseId,
          });
        }

        await callWithRetry(
          documentClient,
          "send",
          new PutCommand({
            TableName: knowledgeBasesTableName(),
            Item: knowledgeBase,
            ConditionExpression: "attribute_not_exists(knowledgeBaseId)",
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "createKnowledgeBase" }
        );

        return knowledgeBase;
      } catch (error: any) {
        logger.error("Failed to create knowledge base", {
          error,
          tenantId: knowledgeBase.tenantId,
          knowledgeBaseId: knowledgeBase.knowledgeBaseId,
        });

        if (error instanceof ConflictError) {
          throw error;
        }

        if (error.name === "ConditionalCheckFailedException") {
          throw new ConflictError("Knowledge base already exists", {
            tenantId: knowledgeBase.tenantId,
            knowledgeBaseId: knowledgeBase.knowledgeBaseId,
          });
        }

        throw new ServiceUnavailableError(
          "Failed to create knowledge base due to a service error",
          { cause: error.message }
        );
      }
    },
    { resourceType: "KNOWLEDGE_BASE" }
  );
}

/**
 * Gets a knowledge base by ID
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @returns The knowledge base or null if not found
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function getKnowledgeBase(
  tenantId: string,
  knowledgeBaseId: string
): Promise<KnowledgeBase | null> {
  return trackPerformance(
    tenantId,
    "getKnowledgeBase",
    async () => {
      logger.info("Getting knowledge base", { tenantId, knowledgeBaseId });

      try {
        const response = await callWithRetry<GetCommandOutput, GetCommand>(
          documentClient,
          "send",
          new GetCommand({
            TableName: knowledgeBasesTableName(),
            Key: {
              tenantId,
              knowledgeBaseId,
            },
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "getKnowledgeBase" }
        );

        return response.Item as KnowledgeBase;
      } catch (error: any) {
        logger.error("Failed to get knowledge base", {
          error,
          tenantId,
          knowledgeBaseId,
        });

        throw new ServiceUnavailableError(
          "Failed to get knowledge base due to a service error",
          { cause: error.message }
        );
      }
    },
    { resourceId: knowledgeBaseId, resourceType: "KNOWLEDGE_BASE" }
  );
}

/**
 * Lists knowledge bases for a tenant
 *
 * @param tenantId - The tenant ID
 * @param limit - Maximum number of results to return
 * @param lastEvaluatedKey - The last evaluated key for pagination
 * @returns The knowledge bases and the next token
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function listKnowledgeBasesForTenant(
  tenantId: string,
  limit = 20,
  lastEvaluatedKey?: any
): Promise<{ items: KnowledgeBase[]; nextToken?: string }> {
  return trackPerformance(
    tenantId,
    "listKnowledgeBasesForTenant",
    async () => {
      logger.info("Listing knowledge bases for tenant", { tenantId, limit });

      try {
        const params: any = {
          TableName: knowledgeBasesTableName(),
          KeyConditionExpression: "tenantId = :tenantId",
          ExpressionAttributeValues: {
            ":tenantId": tenantId,
          },
          Limit: limit,
        };

        if (lastEvaluatedKey) {
          params.ExclusiveStartKey = JSON.parse(
            Buffer.from(lastEvaluatedKey, "base64").toString()
          );
        }

        const response = await callWithRetry<QueryCommandOutput, QueryCommand>(
          documentClient,
          "send",
          new QueryCommand(params),
          DEFAULT_RETRY_CONFIG,
          { operation: "listKnowledgeBasesForTenant" }
        );

        let nextToken;
        if (response.LastEvaluatedKey) {
          nextToken = Buffer.from(
            JSON.stringify(response.LastEvaluatedKey)
          ).toString("base64");
        }

        // Record metric for listed items count
        recordKnowledgeBaseMetric(
          tenantId,
          "listKnowledgeBases",
          "success",
          0,
          { itemCount: String(response.Items?.length || 0) }
        );

        return {
          items: (response.Items || []) as KnowledgeBase[],
          nextToken,
        };
      } catch (error: any) {
        logger.error("Failed to list knowledge bases", { error, tenantId });

        throw new ServiceUnavailableError(
          "Failed to list knowledge bases due to a service error",
          { cause: error.message }
        );
      }
    },
    { resourceType: "KNOWLEDGE_BASE" }
  );
}

/**
 * Updates a knowledge base
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @param updates - The updates to apply
 * @returns The updated knowledge base
 * @throws NotFoundError if knowledge base does not exist
 * @throws ValidationError if updates are invalid
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function updateKnowledgeBase(
  tenantId: string,
  knowledgeBaseId: string,
  updates: Partial<KnowledgeBase>
): Promise<KnowledgeBase | null> {
  return trackPerformance(
    tenantId,
    "updateKnowledgeBase",
    async () => {
      logger.info("Updating knowledge base", {
        tenantId,
        knowledgeBaseId,
        updates,
      });

      // Check if knowledge base exists
      const existingKB = await getKnowledgeBase(tenantId, knowledgeBaseId);
      if (!existingKB) {
        throw new NotFoundError("Knowledge base not found", {
          tenantId,
          knowledgeBaseId,
        });
      }

      // Validate updates
      if (updates.tenantId || updates.knowledgeBaseId || updates.createdAt) {
        throw new ValidationError("Cannot update immutable fields", {
          immutableFields: ["tenantId", "knowledgeBaseId", "createdAt"],
        });
      }

      try {
        // Build update expression and attribute values
        let updateExpression = "SET updatedAt = :updatedAt";
        const expressionAttributeValues: Record<string, any> = {
          ":updatedAt": new Date().toISOString(),
        };

        // Add each update to the expression
        Object.entries(updates).forEach(([key, value]) => {
          if (
            key !== "tenantId" &&
            key !== "knowledgeBaseId" &&
            key !== "createdAt"
          ) {
            updateExpression += `, ${key} = :${key}`;
            expressionAttributeValues[`:${key}`] = value;
          }
        });

        const response = await callWithRetry<
          UpdateCommandOutput,
          UpdateCommand
        >(
          documentClient,
          "send",
          new UpdateCommand({
            TableName: knowledgeBasesTableName(),
            Key: {
              tenantId,
              knowledgeBaseId,
            },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "ALL_NEW",
            ConditionExpression: "attribute_exists(knowledgeBaseId)",
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "updateKnowledgeBase" }
        );

        return response.Attributes as KnowledgeBase;
      } catch (error: any) {
        logger.error("Failed to update knowledge base", {
          error,
          tenantId,
          knowledgeBaseId,
        });

        if (error.name === "ConditionalCheckFailedException") {
          throw new NotFoundError("Knowledge base not found", {
            tenantId,
            knowledgeBaseId,
          });
        }

        throw new ServiceUnavailableError(
          "Failed to update knowledge base due to a service error",
          { cause: error.message }
        );
      }
    },
    { resourceId: knowledgeBaseId, resourceType: "KNOWLEDGE_BASE" }
  );
}

/**
 * Deletes a knowledge base
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @throws NotFoundError if knowledge base does not exist
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function deleteKnowledgeBase(
  tenantId: string,
  knowledgeBaseId: string
): Promise<void> {
  await trackPerformance(
    tenantId,
    "deleteKnowledgeBase",
    async () => {
      logger.info("Deleting knowledge base", { tenantId, knowledgeBaseId });

      // Check if knowledge base exists
      const existingKB = await getKnowledgeBase(tenantId, knowledgeBaseId);
      if (!existingKB) {
        throw new NotFoundError("Knowledge base not found", {
          tenantId,
          knowledgeBaseId,
        });
      }

      try {
        await callWithRetry(
          documentClient,
          "send",
          new DeleteCommand({
            TableName: knowledgeBasesTableName(),
            Key: {
              tenantId,
              knowledgeBaseId,
            },
            ConditionExpression: "attribute_exists(knowledgeBaseId)",
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "deleteKnowledgeBase" }
        );
      } catch (error: any) {
        logger.error("Failed to delete knowledge base", {
          error,
          tenantId,
          knowledgeBaseId,
        });

        if (error.name === "ConditionalCheckFailedException") {
          throw new NotFoundError("Knowledge base not found", {
            tenantId,
            knowledgeBaseId,
          });
        }

        throw new ServiceUnavailableError(
          "Failed to delete knowledge base due to a service error",
          { cause: error.message }
        );
      }
    },
    { resourceId: knowledgeBaseId, resourceType: "KNOWLEDGE_BASE" }
  );
}

/**
 * Creates a knowledge base document
 *
 * @param document - The document to create
 * @returns The created document
 * @throws ValidationError if document data is invalid
 * @throws ConflictError if document already exists
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function createKnowledgeBaseDocument(
  document: KnowledgeBaseDocument
): Promise<KnowledgeBaseDocument> {
  // Validate required fields
  if (
    !document.tenantId ||
    !document.knowledgeBaseId ||
    !document.documentId ||
    !document.name
  ) {
    throw new ValidationError("Missing required fields", {
      requiredFields: ["tenantId", "knowledgeBaseId", "documentId", "name"],
    });
  }

  return trackPerformance(
    document.tenantId,
    "createKnowledgeBaseDocument",
    async () => {
      logger.info("Creating knowledge base document", {
        tenantId: document.tenantId,
        knowledgeBaseId: document.knowledgeBaseId,
        documentId: document.documentId,
        name: document.name,
      });

      // Check if knowledge base exists
      const existingKB = await getKnowledgeBase(
        document.tenantId,
        document.knowledgeBaseId
      );

      if (!existingKB) {
        throw new NotFoundError("Knowledge base not found", {
          tenantId: document.tenantId,
          knowledgeBaseId: document.knowledgeBaseId,
        });
      }

      try {
        await callWithRetry(
          documentClient,
          "send",
          new PutCommand({
            TableName: knowledgeBaseDocumentsTableName(),
            Item: document,
            ConditionExpression: "attribute_not_exists(documentId)",
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "createKnowledgeBaseDocument" }
        );

        // Update document count in knowledge base
        await updateKnowledgeBaseDocumentCount(
          document.tenantId,
          document.knowledgeBaseId,
          1
        );

        // Report document processing stats with proper parameters
        await reportDocumentProcessing(
          document.tenantId,
          document.knowledgeBaseId,
          1, // documentCount
          document.size || 0 // totalSize
        );

        return document;
      } catch (error: any) {
        logger.error("Failed to create knowledge base document", {
          error,
          tenantId: document.tenantId,
          knowledgeBaseId: document.knowledgeBaseId,
          documentId: document.documentId,
        });

        if (error.name === "ConditionalCheckFailedException") {
          throw new ConflictError("Document already exists", {
            knowledgeBaseId: document.knowledgeBaseId,
            documentId: document.documentId,
          });
        }

        throw new ServiceUnavailableError(
          "Failed to create document due to a service error",
          { cause: error.message }
        );
      }
    },
    {
      resourceId: document.documentId,
      resourceType: "DOCUMENT",
      documentSize: String(document.size || 0),
    }
  );
}

/**
 * Gets a knowledge base document by ID
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentId - The document ID
 * @returns The document or null if not found
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function getKnowledgeBaseDocument(
  tenantId: string,
  knowledgeBaseId: string,
  documentId: string
): Promise<KnowledgeBaseDocument | null> {
  return trackPerformance(
    tenantId,
    "getKnowledgeBaseDocument",
    async () => {
      logger.info("Getting knowledge base document", {
        tenantId,
        knowledgeBaseId,
        documentId,
      });

      try {
        const response = await callWithRetry<GetCommandOutput, GetCommand>(
          documentClient,
          "send",
          new GetCommand({
            TableName: knowledgeBaseDocumentsTableName(),
            Key: {
              knowledgeBaseId,
              documentId,
            },
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "getKnowledgeBaseDocument" }
        );

        const document = response.Item as KnowledgeBaseDocument;

        // Verify tenant ID matches to prevent unauthorized access
        if (document && document.tenantId !== tenantId) {
          logger.warn("Tenant ID mismatch when retrieving document", {
            requestTenantId: tenantId,
            documentTenantId: document.tenantId,
          });
          return null;
        }

        return document;
      } catch (error: any) {
        logger.error("Failed to get knowledge base document", {
          error,
          tenantId,
          knowledgeBaseId,
          documentId,
        });

        throw new ServiceUnavailableError(
          "Failed to get document due to a service error",
          { cause: error.message }
        );
      }
    },
    {
      resourceId: documentId,
      resourceType: "DOCUMENT",
    }
  );
}

/**
 * Lists documents for a knowledge base
 *
 * @param knowledgeBaseId - The knowledge base ID
 * @param limit - Maximum number of results to return
 * @param lastEvaluatedKey - The last evaluated key for pagination
 * @returns The documents and the next token
 */
export async function listKnowledgeBaseDocuments(
  knowledgeBaseId: string,
  limit = 20,
  lastEvaluatedKey?: any
): Promise<{ items: KnowledgeBaseDocument[]; nextToken?: string }> {
  logger.info("Listing knowledge base documents", { knowledgeBaseId, limit });

  try {
    const params: any = {
      TableName: knowledgeBaseDocumentsTableName(),
      KeyConditionExpression: "knowledgeBaseId = :knowledgeBaseId",
      ExpressionAttributeValues: {
        ":knowledgeBaseId": knowledgeBaseId,
      },
      Limit: limit,
    };

    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = lastEvaluatedKey;
    }

    const response = await documentClient.send(new QueryCommand(params));

    let nextToken;
    if (response.LastEvaluatedKey) {
      nextToken = Buffer.from(
        JSON.stringify(response.LastEvaluatedKey)
      ).toString("base64");
    }

    return {
      items: (response.Items || []) as KnowledgeBaseDocument[],
      nextToken,
    };
  } catch (error) {
    logger.error("Failed to list knowledge base documents", {
      error,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Updates a knowledge base document
 *
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentId - The document ID
 * @param updates - The updates to apply
 * @returns The updated document
 */
export async function updateKnowledgeBaseDocument(
  knowledgeBaseId: string,
  documentId: string,
  updates: Partial<KnowledgeBaseDocument>
): Promise<KnowledgeBaseDocument | null> {
  logger.info("Updating knowledge base document", {
    knowledgeBaseId,
    documentId,
    updates,
  });

  try {
    // Build update expression and attribute values
    let updateExpression = "SET ";
    const expressionAttributeValues: Record<string, any> = {};
    const expressionAttributeNames: Record<string, string> = {};

    // Add each update to the expression
    Object.entries(updates).forEach(([key, value], index) => {
      if (key !== "knowledgeBaseId" && key !== "documentId") {
        // Handle nested objects
        if (key === "processingStats" && typeof value === "object") {
          Object.entries(value).forEach(([statKey, statValue]) => {
            if (index === 0) {
              updateExpression += `#${key}.#${statKey} = :${key}_${statKey}`;
            } else {
              updateExpression += `, #${key}.#${statKey} = :${key}_${statKey}`;
            }
            expressionAttributeValues[`:${key}_${statKey}`] = statValue;
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeNames[`#${statKey}`] = statKey;
          });
        } else {
          if (index === 0) {
            updateExpression += `${key} = :${key}`;
          } else {
            updateExpression += `, ${key} = :${key}`;
          }
          expressionAttributeValues[`:${key}`] = value;
        }
      }
    });

    // If no updates, return null
    if (Object.keys(expressionAttributeValues).length === 0) {
      return null;
    }

    const params: any = {
      TableName: knowledgeBaseDocumentsTableName(),
      Key: {
        knowledgeBaseId,
        documentId,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };

    // Add expression attribute names if any
    if (Object.keys(expressionAttributeNames).length > 0) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    const response = await documentClient.send(new UpdateCommand(params));

    return response.Attributes as KnowledgeBaseDocument;
  } catch (error) {
    logger.error("Failed to update knowledge base document", {
      error,
      knowledgeBaseId,
      documentId,
    });
    throw error;
  }
}

/**
 * Updates the document count in a knowledge base
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @param increment - The amount to increment by (default: 1)
 */
export async function updateKnowledgeBaseDocumentCount(
  tenantId: string,
  knowledgeBaseId: string,
  increment: number = 1
): Promise<void> {
  logger.info("Updating knowledge base document count", {
    tenantId,
    knowledgeBaseId,
    increment,
  });

  try {
    await documentClient.send(
      new UpdateCommand({
        TableName: knowledgeBasesTableName(),
        Key: {
          tenantId,
          knowledgeBaseId,
        },
        UpdateExpression:
          "SET documentCount = documentCount + :inc, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":inc": increment,
          ":updatedAt": new Date().toISOString(),
        },
      })
    );
  } catch (error) {
    logger.error("Failed to update knowledge base document count", {
      error,
      tenantId,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Deletes a knowledge base document
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentId - The document ID
 * @throws NotFoundError if document does not exist
 * @throws ServiceUnavailableError if DynamoDB operation fails
 */
export async function deleteKnowledgeBaseDocument(
  tenantId: string,
  knowledgeBaseId: string,
  documentId: string
): Promise<void> {
  return trackPerformance(
    tenantId,
    "deleteKnowledgeBaseDocument",
    async () => {
      logger.info("Deleting knowledge base document", {
        tenantId,
        knowledgeBaseId,
        documentId,
      });

      try {
        // Get the document to check if it exists
        const document = await getKnowledgeBaseDocument(
          tenantId,
          knowledgeBaseId,
          documentId
        );

        if (!document) {
          throw new NotFoundError("Document not found for deletion", {
            tenantId,
            knowledgeBaseId,
            documentId,
          });
        }

        await callWithRetry(
          documentClient,
          "send",
          new DeleteCommand({
            TableName: knowledgeBaseDocumentsTableName(),
            Key: {
              knowledgeBaseId,
              documentId,
            },
            ConditionExpression: "attribute_exists(documentId)",
          }),
          DEFAULT_RETRY_CONFIG,
          { operation: "deleteKnowledgeBaseDocument" }
        );

        // Update document count in knowledge base
        await updateKnowledgeBaseDocumentCount(tenantId, knowledgeBaseId, -1);
      } catch (error: any) {
        logger.error("Failed to delete knowledge base document", {
          error,
          tenantId,
          knowledgeBaseId,
          documentId,
        });

        if (error instanceof NotFoundError) {
          throw error;
        }

        if (error.name === "ConditionalCheckFailedException") {
          throw new NotFoundError("Document not found", {
            tenantId,
            knowledgeBaseId,
            documentId,
          });
        }

        throw new ServiceUnavailableError(
          "Failed to delete document due to a service error",
          { cause: error.message }
        );
      }
    },
    { resourceId: documentId, resourceType: "DOCUMENT" }
  );
}

/**
 * Creates an ingestion job record
 *
 * @param job - The ingestion job to create
 * @returns The created ingestion job
 */
export async function createIngestionJob(
  job: KnowledgeBaseIngestionJob
): Promise<KnowledgeBaseIngestionJob> {
  logger.info("Creating ingestion job", {
    knowledgeBaseId: job.knowledgeBaseId,
    dataSourceId: job.dataSourceId,
    ingestionJobId: job.ingestionJobId,
  });

  try {
    await documentClient.send(
      new PutCommand({
        TableName: knowledgeBaseIngestionJobsTableName(),
        Item: job,
      })
    );

    return job;
  } catch (error) {
    logger.error("Failed to create ingestion job", {
      error,
      knowledgeBaseId: job.knowledgeBaseId,
      dataSourceId: job.dataSourceId,
      ingestionJobId: job.ingestionJobId,
    });
    throw error;
  }
}

/**
 * Updates an ingestion job
 *
 * @param knowledgeBaseId - The knowledge base ID
 * @param ingestionJobId - The ingestion job ID
 * @param updates - The updates to apply
 * @returns The updated ingestion job
 */
export async function updateIngestionJob(
  knowledgeBaseId: string,
  ingestionJobId: string,
  updates: Partial<KnowledgeBaseIngestionJob>
): Promise<KnowledgeBaseIngestionJob | null> {
  logger.info("Updating ingestion job", {
    knowledgeBaseId,
    ingestionJobId,
    updates,
  });

  try {
    // Build update expression and attribute values
    let updateExpression = "SET ";
    const expressionAttributeValues: Record<string, any> = {};

    // Add each update to the expression
    Object.entries(updates).forEach(([key, value], index) => {
      if (key !== "knowledgeBaseId" && key !== "ingestionJobId") {
        if (index === 0) {
          updateExpression += `${key} = :${key}`;
        } else {
          updateExpression += `, ${key} = :${key}`;
        }
        expressionAttributeValues[`:${key}`] = value;
      }
    });

    const response = await documentClient.send(
      new UpdateCommand({
        TableName: knowledgeBaseIngestionJobsTableName(),
        Key: {
          knowledgeBaseId,
          ingestionJobId,
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
      })
    );

    return response.Attributes as KnowledgeBaseIngestionJob;
  } catch (error) {
    logger.error("Failed to update ingestion job", {
      error,
      knowledgeBaseId,
      ingestionJobId,
    });
    throw error;
  }
}

/**
 * Gets an ingestion job by ID
 *
 * @param knowledgeBaseId - The knowledge base ID
 * @param ingestionJobId - The ingestion job ID
 * @returns The ingestion job or null if not found
 */
export async function getIngestionJob(
  knowledgeBaseId: string,
  ingestionJobId: string
): Promise<KnowledgeBaseIngestionJob | null> {
  logger.info("Getting ingestion job", { knowledgeBaseId, ingestionJobId });

  try {
    const response = await documentClient.send(
      new GetCommand({
        TableName: knowledgeBaseIngestionJobsTableName(),
        Key: {
          knowledgeBaseId,
          ingestionJobId,
        },
      })
    );

    return response.Item as KnowledgeBaseIngestionJob;
  } catch (error) {
    logger.error("Failed to get ingestion job", {
      error,
      knowledgeBaseId,
      ingestionJobId,
    });
    throw error;
  }
}

/**
 * Creates a new knowledge base with all necessary setup
 *
 * @param tenantId - The tenant ID
 * @param name - The knowledge base name
 * @param description - Optional description
 * @returns The created knowledge base
 * @throws ValidationError if input parameters are invalid
 * @throws ServiceUnavailableError if any operation fails
 */
export async function createNewKnowledgeBase(
  tenantId: string,
  name: string,
  description?: string
): Promise<KnowledgeBase> {
  // Validate input
  if (!tenantId) {
    throw new ValidationError("Missing tenant ID");
  }

  if (!name) {
    throw new ValidationError("Missing knowledge base name");
  }

  if (name.length > 100) {
    throw new ValidationError(
      "Knowledge base name must be 100 characters or less"
    );
  }

  if (description && description.length > 200) {
    throw new ValidationError("Description must be 200 characters or less");
  }

  return trackPerformance(
    tenantId,
    "createNewKnowledgeBase",
    async () => {
      const knowledgeBaseId = ulid();
      logger.info("Creating new knowledge base with Bedrock integration", {
        tenantId,
        knowledgeBaseId,
        name,
      });

      try {
        // Create knowledge base in Bedrock
        const bedrockResult = await createBedrockKnowledgeBase(
          tenantId,
          name,
          description
        );

        // Create the knowledge base record
        const knowledgeBase: KnowledgeBase = {
          tenantId,
          knowledgeBaseId,
          name,
          description,
          bedrockKnowledgeBaseId: bedrockResult.bedrockKnowledgeBaseId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          documentCount: 0,
          status: bedrockResult.status || "CREATING",
        };

        await createKnowledgeBase(knowledgeBase);

        return knowledgeBase;
      } catch (error: any) {
        logger.error("Failed to create new knowledge base", {
          error,
          tenantId,
          name,
        });

        throw new ServiceUnavailableError(
          "Failed to create complete knowledge base setup",
          { cause: error.message }
        );
      }
    },
    { resourceType: "KNOWLEDGE_BASE" }
  );
}
