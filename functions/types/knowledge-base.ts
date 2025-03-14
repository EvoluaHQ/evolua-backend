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
}

/**
 * Represents a document uploaded to a Knowledge Base
 */
export interface KnowledgeBaseDocument {
  tenantId: string; // Organization or user ID
  knowledgeBaseId: string; // Parent knowledge base ID
  documentId: string; // Document UUID
  name: string; // Original filename
  type: "DOCUMENTATION" | "CODE_REPOSITORY" | "OTHER";
  sourceUrl?: string; // GitHub repo URL if applicable
  size: number; // Size in bytes
  fileType: string; // File extension or format
  uploadedAt: string; // ISO timestamp
  status: "PROCESSING" | "READY" | "FAILED";
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
  documentId: string;
  status: "STARTED" | "COMPLETE" | "FAILED";
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}
