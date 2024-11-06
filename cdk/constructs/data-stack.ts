import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { EvoluaStackProps } from "./evolua-stack-props";

export class DataStack extends cdk.Stack {
  props: EvoluaStackProps;
  usersTable: dynamodb.Table;
  eventsTable: dynamodb.Table;
  reposTable: dynamodb.Table;
  tenantReposTable: dynamodb.Table;
  scansTable: dynamodb.Table;
  scanResultsTable: dynamodb.Table;
  eventBus: events.EventBus;
  dataRemovalPolicy: cdk.RemovalPolicy;

  constructor(scope: Construct, id: string, props: EvoluaStackProps) {
    super(scope, id);

    this.props = props;

    this.dataRemovalPolicy =
      this.props.stageName === "prod"
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY;

    this.usersTable = this.createUsersTable();
    this.createTableParameters("UsersTable", this.usersTable, "users-table");

    this.eventsTable = this.createEventsTable();
    this.createTableParameters("EventsTable", this.eventsTable, "events-table");

    this.reposTable = this.createReposTable();
    this.createTableParameters("ReposTable", this.reposTable, "repos-table");

    this.tenantReposTable = this.createTenantReposTable();
    this.createTableParameters(
      "TenantReposTable",
      this.tenantReposTable,
      "tenant-repos-table"
    );

    this.scansTable = this.createScansTable();
    this.createTableParameters("ScansTable", this.scansTable, "scans-table");

    this.scanResultsTable = this.createScanResultsTable();
    this.createTableParameters(
      "ScanResultsTable",
      this.scanResultsTable,
      "scan-results-table"
    );

    this.eventBus = this.createEventBus();
    new ssm.StringParameter(this, "EventBusName", {
      parameterName: `/evolua/${props.stageName}/event-bus/name`,
      stringValue: this.eventBus.eventBusName,
    });
    new ssm.StringParameter(this, "EventBusArn", {
      parameterName: `/evolua/${props.stageName}/event-bus/arn`,
      stringValue: this.eventBus.eventBusArn,
    });

    this.createGitHubPrOpenedEventHandlerFunction();
    this.createGitHubInstallationAddedEventHandlerFunction();
    this.createGitHubInstallationRemovedEventHandlerFunction();

    this.createClerkUserUpsertedEventHandlerFunction();
    this.createClerkUserDeletedEventHandlerFunction();

    new cdk.CfnOutput(this, "SSM_STAGE_NAME", {
      key: "SsmStageName",
      value: this.props.ssmStageName,
    });

    new cdk.CfnOutput(this, "AWS_REGION", {
      key: "AwsRegion",
      value: cdk.Aws.REGION,
    });

    new cdk.CfnOutput(this, "USERS_TABLE_NAME", {
      key: "UsersTableName",
      value: this.usersTable.tableName,
    });

    new cdk.CfnOutput(this, "REPOS_TABLE_NAME", {
      key: "ReposTableName",
      value: this.reposTable.tableName,
    });

    new cdk.CfnOutput(this, "TENANT_REPOS_TABLE_NAME", {
      key: "TenantReposTableName",
      value: this.tenantReposTable.tableName,
    });

    new cdk.CfnOutput(this, "SCANS_TABLE_NAME", {
      key: "ScansTableName",
      value: this.scansTable.tableName,
    });
    new cdk.CfnOutput(this, "SCAN_RESULTS_TABLE_NAME", {
      key: "ScanResultsTableName",
      value: this.scanResultsTable.tableName,
    });
  }

  private createEventBus(): events.EventBus {
    return new events.EventBus(this, "EventBus", {
      eventBusName: `evolua-events-${this.props.stageName}`,
    });
  }

  private createUsersTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, "UsersTable", {
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: "emailIndex",
      partitionKey: {
        name: "email",
        type: dynamodb.AttributeType.STRING,
      },
    });

    table.addGlobalSecondaryIndex({
      indexName: "clerkUserIdIndex",
      partitionKey: {
        name: "clerkUserId",
        type: dynamodb.AttributeType.STRING,
      },
    });

    table.addGlobalSecondaryIndex({
      indexName: "githubHandleIndex",
      partitionKey: {
        name: "githubHandle",
        type: dynamodb.AttributeType.STRING,
      },
    });

    return table;
  }

  private createEventsTable(): dynamodb.Table {
    return new dynamodb.Table(this, "EventsTable", {
      partitionKey: {
        name: "source",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "eventId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy,
    });
  }

  private createReposTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, "ReposTable", {
      partitionKey: {
        name: "repoId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy,
    });

    return table;
  }

  private createTenantReposTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, "TenantReposTable", {
      partitionKey: {
        name: "tenantId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "repoId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy,
    });

    return table;
  }

  private createScansTable(): dynamodb.Table {
    return new dynamodb.Table(this, "ScansTable", {
      partitionKey: {
        name: "repoId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "scanId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy,
    });
  }

  private createScanResultsTable(): dynamodb.Table {
    return new dynamodb.Table(this, "ScanResultsTable", {
      partitionKey: {
        name: "scanId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "file",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy,
    });
  }

  private createTableParameters(
    id: string,
    table: dynamodb.Table,
    ssmPath: string
  ) {
    new ssm.StringParameter(this, `${id}Name`, {
      parameterName: `/evolua/${this.props.stageName}/dynamodb/${ssmPath}/name`,
      stringValue: table.tableName,
    });
    new ssm.StringParameter(this, `${id}Arn`, {
      parameterName: `/evolua/${this.props.stageName}/dynamodb/${ssmPath}/arn`,
      stringValue: table.tableArn,
    });
    new ssm.StringParameter(this, `${id}StreamArn`, {
      parameterName: `/evolua/${this.props.stageName}/dynamodb/${ssmPath}/stream-arn`,
      stringValue: table.tableStreamArn || "",
    });
  }

  private createGitHubPrOpenedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(
      this,
      "GitHubPrOpenedHandlerFunction",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        entry: "functions/github-pr-opened.ts",
        handler: "handler",
        memorySize: 1024,
        timeout: cdk.Duration.minutes(5),
        bundling: {
          minify: true, // Minify code for production
          sourceMap: false, // Include source maps for better debugging
          externalModules: [
            // Modules that should be excluded from bundling
            "aws-sdk", // AWS SDK is available in the Lambda runtime
          ],
          target: "node20", // Target Node.js version
        },
        environment: {
          SCANS_TABLE_NAME: this.scansTable.tableName,
          SCAN_RESULTS_TABLE_NAME: this.scanResultsTable.tableName,
          STAGE_NAME: this.props.stageName,
          SSM_STAGE_NAME: this.props.ssmStageName,
        },
      }
    );

    const ghWebhookRule = new events.Rule(this, "GithubPrRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["github"],
        detail: {
          metadata: {
            type: ["pull_request.opened"],
          },
        },
      },
    });
    ghWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter*"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/github/app-id`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/github/private-key`,
        ],
      })
    );

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      })
    );

    this.scansTable.grantWriteData(handler);
    this.scanResultsTable.grantWriteData(handler);
  }

  private createGitHubInstallationAddedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(
      this,
      "GitHubInstallationAddedHandlerFunction",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        entry: "functions/github-installation-added.js",
        handler: "handler",
        memorySize: 1024,
        timeout: cdk.Duration.seconds(6),
        environment: {
          REPOS_TABLE_NAME: this.reposTable.tableName,
          TENANT_REPOS_TABLE_NAME: this.tenantReposTable.tableName,
          USERS_TABLE_NAME: this.usersTable.tableName,
        },
      }
    );

    const ghWebhookRule = new events.Rule(this, "GithubInstallAddedRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["github"],
        detail: {
          metadata: {
            type: ["installation.added"],
          },
        },
      },
    });
    ghWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.reposTable.grantWriteData(handler);
    this.tenantReposTable.grantWriteData(handler);
    this.usersTable.grantReadData(handler);
  }

  private createGitHubInstallationRemovedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(
      this,
      "GitHubInstallationRemovedHandlerFunction",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        entry: "functions/github-installation-removed.js",
        handler: "handler",
        memorySize: 1024,
        timeout: cdk.Duration.seconds(6),
        environment: {
          REPOS_TABLE_NAME: this.reposTable.tableName,
        },
      }
    );

    const ghWebhookRule = new events.Rule(this, "GithubInstallRemovedRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["github"],
        detail: {
          metadata: {
            type: ["installation.removed"],
          },
        },
      },
    });
    ghWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.reposTable.grantWriteData(handler);
  }

  private createClerkUserUpsertedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(
      this,
      "ClerkUserUpsertedHandlerFunction",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        entry: "functions/clerk-user-upserted.js",
        handler: "handler",
        memorySize: 1024,
        timeout: cdk.Duration.seconds(6),
        environment: {
          USERS_TABLE_NAME: this.usersTable.tableName,
        },
      }
    );

    const clerkWebhookRule = new events.Rule(this, "ClerkUserUpserted", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["clerk"],
        detail: {
          metadata: {
            type: ["user.created", "user.updated"],
          },
        },
      },
    });
    clerkWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.usersTable.grantReadWriteData(handler);
  }

  private createClerkUserDeletedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(
      this,
      "ClerkUserDeletedHandlerFunction",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
        entry: "functions/clerk-user-deleted.js",
        handler: "handler",
        memorySize: 1024,
        timeout: cdk.Duration.seconds(6),
        environment: {
          USERS_TABLE_NAME: this.usersTable.tableName,
        },
      }
    );

    const clerkWebhookRule = new events.Rule(this, "ClerkUserDeleted", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["clerk"],
        detail: {
          metadata: {
            type: ["user.deleted"],
          },
        },
      },
    });
    clerkWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.usersTable.grantReadWriteData(handler);
  }
}
