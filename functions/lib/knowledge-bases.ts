import { Logger } from "@aws-lambda-powertools/logger";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import {
  KnowledgeBase,
  KnowledgeBaseDocument,
  KnowledgeBaseIngestionJob,
} from "../types/knowledge-base";
import {
  documentClient,
  knowledgeBaseDocumentsTableName,
  knowledgeBaseIngestionJobsTableName,
  knowledgeBasesTableName,
} from "./dynamodb-helper";

const logger = new Logger({ serviceName: "knowledge-bases" });

/**
 * Creates a new knowledge base
 *
 * @param knowledgeBase - The knowledge base to create
 * @returns The created knowledge base
 */
export async function createKnowledgeBase(
  knowledgeBase: KnowledgeBase
): Promise<KnowledgeBase> {
  logger.info("Creating knowledge base", {
    tenantId: knowledgeBase.tenantId,
    knowledgeBaseId: knowledgeBase.knowledgeBaseId,
    name: knowledgeBase.name,
  });

  try {
    await documentClient.send(
      new PutCommand({
        TableName: knowledgeBasesTableName(),
        Item: knowledgeBase,
      })
    );

    return knowledgeBase;
  } catch (error) {
    logger.error("Failed to create knowledge base", {
      error,
      tenantId: knowledgeBase.tenantId,
      knowledgeBaseId: knowledgeBase.knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Gets a knowledge base by ID
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @returns The knowledge base or null if not found
 */
export async function getKnowledgeBase(
  tenantId: string,
  knowledgeBaseId: string
): Promise<KnowledgeBase | null> {
  logger.info("Getting knowledge base", { tenantId, knowledgeBaseId });

  try {
    const response = await documentClient.send(
      new GetCommand({
        TableName: knowledgeBasesTableName(),
        Key: {
          tenantId,
          knowledgeBaseId,
        },
      })
    );

    return response.Item as KnowledgeBase;
  } catch (error) {
    logger.error("Failed to get knowledge base", {
      error,
      tenantId,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Lists knowledge bases for a tenant
 *
 * @param tenantId - The tenant ID
 * @param limit - Maximum number of results to return
 * @param lastEvaluatedKey - The last evaluated key for pagination
 * @returns The knowledge bases and the next token
 */
export async function listKnowledgeBasesForTenant(
  tenantId: string,
  limit = 20,
  lastEvaluatedKey?: any
): Promise<{ items: KnowledgeBase[]; nextToken?: string }> {
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
      items: (response.Items || []) as KnowledgeBase[],
      nextToken,
    };
  } catch (error) {
    logger.error("Failed to list knowledge bases", { error, tenantId });
    throw error;
  }
}

/**
 * Updates a knowledge base
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 * @param updates - The updates to apply
 * @returns The updated knowledge base
 */
export async function updateKnowledgeBase(
  tenantId: string,
  knowledgeBaseId: string,
  updates: Partial<KnowledgeBase>
): Promise<KnowledgeBase | null> {
  logger.info("Updating knowledge base", {
    tenantId,
    knowledgeBaseId,
    updates,
  });

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

    const response = await documentClient.send(
      new UpdateCommand({
        TableName: knowledgeBasesTableName(),
        Key: {
          tenantId,
          knowledgeBaseId,
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
      })
    );

    return response.Attributes as KnowledgeBase;
  } catch (error) {
    logger.error("Failed to update knowledge base", {
      error,
      tenantId,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Deletes a knowledge base
 *
 * @param tenantId - The tenant ID
 * @param knowledgeBaseId - The knowledge base ID
 */
export async function deleteKnowledgeBase(
  tenantId: string,
  knowledgeBaseId: string
): Promise<void> {
  logger.info("Deleting knowledge base", { tenantId, knowledgeBaseId });

  try {
    await documentClient.send(
      new DeleteCommand({
        TableName: knowledgeBasesTableName(),
        Key: {
          tenantId,
          knowledgeBaseId,
        },
      })
    );
  } catch (error) {
    logger.error("Failed to delete knowledge base", {
      error,
      tenantId,
      knowledgeBaseId,
    });
    throw error;
  }
}

/**
 * Creates a knowledge base document
 *
 * @param document - The document to create
 * @returns The created document
 */
export async function createKnowledgeBaseDocument(
  document: KnowledgeBaseDocument
): Promise<KnowledgeBaseDocument> {
  logger.info("Creating knowledge base document", {
    tenantId: document.tenantId,
    knowledgeBaseId: document.knowledgeBaseId,
    documentId: document.documentId,
    name: document.name,
  });

  try {
    await documentClient.send(
      new PutCommand({
        TableName: knowledgeBaseDocumentsTableName(),
        Item: document,
      })
    );

    // Update document count in knowledge base
    await updateKnowledgeBaseDocumentCount(
      document.tenantId,
      document.knowledgeBaseId,
      1
    );

    return document;
  } catch (error) {
    logger.error("Failed to create knowledge base document", {
      error,
      tenantId: document.tenantId,
      knowledgeBaseId: document.knowledgeBaseId,
      documentId: document.documentId,
    });
    throw error;
  }
}

/**
 * Gets a knowledge base document by ID
 *
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentId - The document ID
 * @returns The document or null if not found
 */
export async function getKnowledgeBaseDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<KnowledgeBaseDocument | null> {
  logger.info("Getting knowledge base document", {
    knowledgeBaseId,
    documentId,
  });

  try {
    const response = await documentClient.send(
      new GetCommand({
        TableName: knowledgeBaseDocumentsTableName(),
        Key: {
          knowledgeBaseId,
          documentId,
        },
      })
    );

    return response.Item as KnowledgeBaseDocument;
  } catch (error) {
    logger.error("Failed to get knowledge base document", {
      error,
      knowledgeBaseId,
      documentId,
    });
    throw error;
  }
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
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentId - The document ID
 */
export async function deleteKnowledgeBaseDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<void> {
  logger.info("Deleting knowledge base document", {
    knowledgeBaseId,
    documentId,
  });

  try {
    // Get the document to check tenantId
    const document = await getKnowledgeBaseDocument(
      knowledgeBaseId,
      documentId
    );

    if (!document) {
      logger.warn("Document not found for deletion", {
        knowledgeBaseId,
        documentId,
      });
      return;
    }

    await documentClient.send(
      new DeleteCommand({
        TableName: knowledgeBaseDocumentsTableName(),
        Key: {
          knowledgeBaseId,
          documentId,
        },
      })
    );

    // Update document count in knowledge base
    await updateKnowledgeBaseDocumentCount(
      document.tenantId,
      knowledgeBaseId,
      -1
    );
  } catch (error) {
    logger.error("Failed to delete knowledge base document", {
      error,
      knowledgeBaseId,
      documentId,
    });
    throw error;
  }
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
 */
export async function createNewKnowledgeBase(
  tenantId: string,
  name: string,
  description?: string
): Promise<KnowledgeBase> {
  const knowledgeBaseId = ulid();

  // Implement the full creation flow here
  // This would be a placeholder for a more complex implementation

  const knowledgeBase: KnowledgeBase = {
    tenantId,
    knowledgeBaseId,
    name,
    description,
    bedrockKnowledgeBaseId: "placeholder", // This would be replaced with actual Bedrock KB ID
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    documentCount: 0,
    status: "CREATING",
  };

  await createKnowledgeBase(knowledgeBase);

  return knowledgeBase;
}
