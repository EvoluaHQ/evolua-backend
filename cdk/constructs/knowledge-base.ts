import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as appsync from "aws-cdk-lib/aws-appsync";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface KnowledgeBaseConstructProps {
  /**
   * The GraphQL API to add resolvers to
   */
  api: appsync.GraphqlApi;

  /**
   * Lambda function for listing knowledge bases
   */
  listKnowledgeBasesFn: lambda.Function;

  /**
   * Lambda function for getting a knowledge base
   */
  getKnowledgeBaseFn: lambda.Function;

  /**
   * Lambda function for creating a knowledge base
   */
  createKnowledgeBaseFn: lambda.Function;

  /**
   * The node runtime version to use
   */
  nodeRuntime: lambda.Runtime;

  /**
   * Lambda timeout in seconds
   */
  timeout?: cdk.Duration;

  /**
   * Memory size for Lambda functions
   */
  memorySize?: number;

  /**
   * Whether to enable X-Ray tracing
   */
  enableTracing?: boolean;
}

/**
 * Construct for the Knowledge Base feature
 */
export class KnowledgeBaseConstruct extends Construct {
  /**
   * The bucket for storing knowledge base documents
   */
  public readonly documentsBucket: s3.Bucket;

  /**
   * The table for storing knowledge bases
   */
  public readonly knowledgeBasesTable: dynamodb.Table;

  /**
   * The table for storing knowledge base documents
   */
  public readonly documentsTable: dynamodb.Table;

  /**
   * The table for storing ingestion jobs
   */
  public readonly ingestionJobsTable: dynamodb.Table;

  constructor(
    scope: Construct,
    id: string,
    props: KnowledgeBaseConstructProps
  ) {
    super(scope, id);

    // Create S3 bucket for knowledge base documents
    this.documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [
        {
          id: "delete-old-versions",
          noncurrentVersionExpiration: cdk.Duration.days(30),
          enabled: true,
        },
      ],
    });

    // Create DynamoDB table for knowledge bases
    this.knowledgeBasesTable = new dynamodb.Table(this, "KnowledgeBasesTable", {
      partitionKey: { name: "tenantId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "knowledgeBaseId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Create DynamoDB table for knowledge base documents
    this.documentsTable = new dynamodb.Table(this, "DocumentsTable", {
      partitionKey: {
        name: "knowledgeBaseId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "documentId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Create a GSI on tenantId for easier querying
    this.documentsTable.addGlobalSecondaryIndex({
      indexName: "TenantIndex",
      partitionKey: { name: "tenantId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Create DynamoDB table for ingestion jobs
    this.ingestionJobsTable = new dynamodb.Table(this, "IngestionJobsTable", {
      partitionKey: {
        name: "knowledgeBaseId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: "ingestionJobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // Create IAM policy for Bedrock access
    const bedrockPolicy = new iam.PolicyStatement({
      actions: [
        "bedrock:CreateKnowledgeBase",
        "bedrock:GetKnowledgeBase",
        "bedrock:UpdateKnowledgeBase",
        "bedrock:DeleteKnowledgeBase",
        "bedrock:CreateDataSource",
        "bedrock:GetDataSource",
        "bedrock:StartIngestionJob",
        "bedrock:GetIngestionJob",
        "bedrock:Retrieve",
      ],
      resources: ["*"],
    });

    // Grant Lambda functions access to DynamoDB tables
    this.knowledgeBasesTable.grantReadWriteData(props.createKnowledgeBaseFn);
    this.knowledgeBasesTable.grantReadData(props.getKnowledgeBaseFn);
    this.knowledgeBasesTable.grantReadData(props.listKnowledgeBasesFn);

    // Grant Lambda functions access to Bedrock
    props.createKnowledgeBaseFn.addToRolePolicy(bedrockPolicy);
    props.getKnowledgeBaseFn.addToRolePolicy(bedrockPolicy);

    // Set environment variables for Lambda functions
    props.createKnowledgeBaseFn.addEnvironment(
      "KNOWLEDGE_BASES_TABLE_NAME",
      this.knowledgeBasesTable.tableName
    );
    props.createKnowledgeBaseFn.addEnvironment(
      "KNOWLEDGE_BASE_DOCUMENTS_TABLE_NAME",
      this.documentsTable.tableName
    );
    props.createKnowledgeBaseFn.addEnvironment(
      "KNOWLEDGE_BASE_INGESTION_JOBS_TABLE_NAME",
      this.ingestionJobsTable.tableName
    );
    props.createKnowledgeBaseFn.addEnvironment(
      "KNOWLEDGE_BASE_BUCKET",
      this.documentsBucket.bucketName
    );

    props.getKnowledgeBaseFn.addEnvironment(
      "KNOWLEDGE_BASES_TABLE_NAME",
      this.knowledgeBasesTable.tableName
    );
    props.getKnowledgeBaseFn.addEnvironment(
      "KNOWLEDGE_BASE_DOCUMENTS_TABLE_NAME",
      this.documentsTable.tableName
    );

    props.listKnowledgeBasesFn.addEnvironment(
      "KNOWLEDGE_BASES_TABLE_NAME",
      this.knowledgeBasesTable.tableName
    );

    // Create Lambda function for syncing GitHub repositories
    const syncGitHubRepoFn = new lambda.Function(this, "SyncGitHubRepoFn", {
      runtime: props.nodeRuntime,
      handler: "connect-github-repo-to-knowledge-base.handler",
      code: lambda.Code.fromAsset(path.resolve(__dirname, "../../functions")),
      timeout: props.timeout || cdk.Duration.seconds(60),
      memorySize: props.memorySize || 1024,
      environment: {
        KNOWLEDGE_BASES_TABLE_NAME: this.knowledgeBasesTable.tableName,
        KNOWLEDGE_BASE_DOCUMENTS_TABLE_NAME: this.documentsTable.tableName,
        KNOWLEDGE_BASE_INGESTION_JOBS_TABLE_NAME:
          this.ingestionJobsTable.tableName,
        KNOWLEDGE_BASE_BUCKET: this.documentsBucket.bucketName,
      },
      tracing: props.enableTracing
        ? lambda.Tracing.ACTIVE
        : lambda.Tracing.DISABLED,
    });

    // Grant permissions to the new function
    this.knowledgeBasesTable.grantReadWriteData(syncGitHubRepoFn);
    this.documentsTable.grantReadWriteData(syncGitHubRepoFn);
    this.ingestionJobsTable.grantReadWriteData(syncGitHubRepoFn);
    this.documentsBucket.grantReadWrite(syncGitHubRepoFn);
    syncGitHubRepoFn.addToRolePolicy(bedrockPolicy);

    // Create scheduled event to check GitHub repositories
    const rule = new events.Rule(this, "SyncGitHubRepoRule", {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      enabled: true,
    });

    rule.addTarget(
      new targets.LambdaFunction(syncGitHubRepoFn, {
        event: events.RuleTargetInput.fromObject({
          action: "CHECK_FOR_UPDATES",
        }),
      })
    );

    // Add resolvers to the GraphQL API
    const listKnowledgeBasesDs = props.api.addLambdaDataSource(
      "ListKnowledgeBasesDS",
      props.listKnowledgeBasesFn,
      {
        description: "List knowledge bases for a tenant",
      }
    );

    const getKnowledgeBaseDs = props.api.addLambdaDataSource(
      "GetKnowledgeBaseDS",
      props.getKnowledgeBaseFn,
      {
        description: "Get a knowledge base by ID",
      }
    );

    const createKnowledgeBaseDs = props.api.addLambdaDataSource(
      "CreateKnowledgeBaseDS",
      props.createKnowledgeBaseFn,
      {
        description: "Create a new knowledge base",
      }
    );

    // Add resolvers
    listKnowledgeBasesDs.createResolver("ListKnowledgeBases", {
      typeName: "Query",
      fieldName: "listKnowledgeBases",
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.resolve(
          __dirname,
          "../../appsync-resolvers/query-list-knowledge-bases.js"
        )
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.resolve(
          __dirname,
          "../../appsync-resolvers/query-list-knowledge-bases.js"
        )
      ),
    });

    getKnowledgeBaseDs.createResolver("GetKnowledgeBase", {
      typeName: "Query",
      fieldName: "getKnowledgeBase",
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.resolve(
          __dirname,
          "../../appsync-resolvers/query-get-knowledge-base.js"
        )
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.resolve(
          __dirname,
          "../../appsync-resolvers/query-get-knowledge-base.js"
        )
      ),
    });

    createKnowledgeBaseDs.createResolver("CreateKnowledgeBase", {
      typeName: "Mutation",
      fieldName: "createKnowledgeBase",
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        path.resolve(
          __dirname,
          "../../appsync-resolvers/mutation-create-knowledge-base.js"
        )
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        path.resolve(
          __dirname,
          "../../appsync-resolvers/mutation-create-knowledge-base.js"
        )
      ),
    });
  }
}
