import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { EvoluaStackProps } from "./evolua-stack-props";
import { TypescriptFunction } from "./typescript-function";

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

    this.createScanGitHubPrFunction();

    this.createGitHubInstallationAddedEventHandlerFunction();
    this.createGitHubInstallationRemovedEventHandlerFunction();

    this.createClerkUserUpsertedEventHandlerFunction();
    this.createClerkUserDeletedEventHandlerFunction();
    
    this.createResetScanCountsFunction();

    this.createAlgoliaSyncTenantReposFunction();
    this.createAlgoliaSyncScansFunction();

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

    table.addGlobalSecondaryIndex({
      indexName: "tenantRepoIdIndex",
      partitionKey: {
        name: "tenantId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "tenantRepoId",
        type: dynamodb.AttributeType.STRING,
      },
    });

    return table;
  }

  private createScansTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, "ScansTable", {
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

    table.addGlobalSecondaryIndex({
      indexName: "byTimestampIndex",
      partitionKey: {
        name: "repoId",
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "timestamp",
        type: dynamodb.AttributeType.STRING,
      },
    });
    
    return table;
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

  private createScanGitHubPrFunction() {
    const handler = new TypescriptFunction(
      this,
      "ScanGitHubPrFunction",
      {
        serviceName: 'scan-github-pr',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/scan-github-pr.ts",
        handler: "handler",
        timeout: cdk.Duration.minutes(5),
        environment: {
          SCANS_TABLE_NAME: this.scansTable.tableName,
          SCAN_RESULTS_TABLE_NAME: this.scanResultsTable.tableName,
          STAGE_NAME: this.props.stageName,
          SSM_STAGE_NAME: this.props.ssmStageName,
          USERS_TABLE_NAME: this.usersTable.tableName,
        },
      }
    );

    const ghWebhookRule = new events.Rule(this, "ScanTriggeredGithubPrRule", {
      eventBus: this.eventBus,
      eventPattern: {
        source: ["github"],
        detail: {
          metadata: {
            type: ["scan_triggered"],
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
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/anthropic/api-key`,
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
    this.usersTable.grantReadWriteData(handler);

    return handler;
  }

  private createGitHubInstallationAddedEventHandlerFunction() {
    const handler = new TypescriptFunction(
      this,
      "GitHubInstallationAddedHandlerFunction",
      {
        serviceName: 'github-installation-added-handler',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/github-installation-added.ts",
        handler: "handler",
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
            type: ["repos_installed"],
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
    const handler = new TypescriptFunction(
      this,
      "GitHubInstallationRemovedHandlerFunction",
      {
        serviceName: 'github-installation-removed-handler',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/github-installation-removed.ts",
        handler: "handler",
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
            type: ["repos_uninstalled"],
          },
        },
      },
    });
    ghWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.reposTable.grantWriteData(handler);
  }

  private createClerkUserUpsertedEventHandlerFunction() {
    const handler = new TypescriptFunction(
      this,
      "ClerkUserUpsertedHandlerFunction",
      {
        serviceName: 'clerk-user-upserted-handler',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/clerk-user-upserted.ts",
        handler: "handler",
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
    const handler = new TypescriptFunction(
      this,
      "ClerkUserDeletedHandlerFunction",
      {
        serviceName: 'clerk-user-deleted-handler',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/clerk-user-deleted.ts",
        handler: "handler",
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

  private createResetScanCountsFunction() {
    // this cron function fetches all users and resets their scan count if their billing cycle is up
    // TODO: refactor this once we have a decent number of users (say, 1000+)
    const handler = new TypescriptFunction(
      this,
      "ResetScanCountsFunction",
      {
        serviceName: 'reset-scan-counts',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/reset-scan-counts.ts",
        handler: "handler",
        timeout: cdk.Duration.seconds(15),
        environment: {
          USERS_TABLE_NAME: this.usersTable.tableName,
        },
      }
    );

    // Create a rule to run the function every day at 00:03 UTC
    new events.Rule(this, "ResetScanCountRule", {
      schedule: events.Schedule.cron({
        minute: "3",
        hour: "0",
      }),
      targets: [new eventTargets.LambdaFunction(handler)],
    });

    this.usersTable.grantReadWriteData(handler);
  }

  private createAlgoliaSyncTenantReposFunction() {
    const handler = new TypescriptFunction(
      this,
      "AlgoliaSyncTenantReposFunction",
      {
        serviceName: 'sync-tenant-repos-to-algolia',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/sync-tenant-repos-to-algolia.ts",
        handler: "handler",
        timeout: cdk.Duration.seconds(30)
      }
    );

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter*"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/app-id`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/write-api-key`
        ],
      })
    );

    this.tenantReposTable.grantStreamRead(handler);

    handler.addEventSourceMapping("SyncTenantReposToAlgoliaESM", {
      eventSourceArn: this.tenantReposTable.tableStreamArn,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
    });
  }

  private createAlgoliaSyncScansFunction() {
    const handler = new TypescriptFunction(
      this,
      "AlgoliaSyncScansFunction",
      {
        serviceName: 'sync-scans-to-algolia',
        stageName: this.props.stageName,
        ssmStageName: this.props.ssmStageName,
        entry: "functions/sync-scans-to-algolia.ts",
        handler: "handler",
        timeout: cdk.Duration.seconds(30),
        environment: {
          SCAN_RESULTS_TABLE_NAME: this.scanResultsTable.tableName,
        }
      }
    );

    handler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter*"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/app-id`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/write-api-key`
        ],
      })
    );

    this.scanResultsTable.grantReadData(handler);
    this.scansTable.grantStreamRead(handler);

    handler.addEventSourceMapping("SyncScansToAlgoliaESM", {
      eventSourceArn: this.scansTable.tableStreamArn,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
    });
  }
}
