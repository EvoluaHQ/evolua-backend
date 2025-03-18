/**
 * Types for AWS Bedrock Knowledge Base integration
 */

/**
 * Represents a Knowledge Base for an organization or user
 */
export interface KnowledgeBase {
  tenantId: string; // Organization or user ID
  knowledgeBaseId: string; // UUID for the knowledge base
  name: string; // User-defined name
  description?: string; // Optional description
  bedrockKnowledgeBaseId: string; // ID from AWS Bedrock
  bedrockDataSourceId?: string; // ID of data source in Bedrock
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  documentCount: number; // Number of documents uploaded
  status: "CREATING" | "READY" | "FAILED" | "UPDATING"; // Status of KB
  // GitHub repository integration fields
  githubRepositoryUrl?: string; // URL of connected GitHub repository
  githubBranch?: string; // Branch of the connected GitHub repository
  lastSyncedAt?: string; // ISO timestamp of last GitHub sync
}

/**
 * Represents a document uploaded to a Knowledge Base
 */
export interface KnowledgeBaseDocument {
  tenantId: string; // Organization or user ID
  knowledgeBaseId: string; // Parent knowledge base ID
  documentId: string; // Document UUID
  name: string; // Original filename
  type?: "DOCUMENTATION" | "CODE_REPOSITORY" | "OTHER"; // Type of document
  sourceUrl?: string; // GitHub repo URL if applicable
  size: number; // Size in bytes
  contentType: string; // MIME type of the content
  s3Key: string; // S3 object key for the document
  tags?: string[]; // User-defined tags for the document
  createdAt: string; // ISO timestamp of creation
  updatedAt: string; // ISO timestamp of last update
  status: "PROCESSING" | "READY" | "FAILED"; // Processing status
  processingStats?: {
    filesProcessed: number;
    totalFiles: number;
    bytesProcessed: number;
    totalBytes: number;
    completedAt?: string;
    errorMessage?: string;
  };
}

/**
 * Type for tracking ingestion jobs in Bedrock
 */
export interface KnowledgeBaseIngestionJob {
  knowledgeBaseId: string;
  dataSourceId: string;
  ingestionJobId: string;
  documentId?: string;
  tenantId: string; // Added for tenant isolation
  status: "STARTED" | "COMPLETE" | "FAILED";
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  retryCount?: number; // Track retry attempts
}

/**
 * Status responses for asynchronous operations
 */
export interface AsyncOperationStatus {
  operationId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
  resourceId?: string;
  resourceType: "KNOWLEDGE_BASE" | "DOCUMENT" | "INGESTION_JOB";
  message?: string;
  startedAt: string;
  completedAt?: string;
  percentComplete?: number;
}
