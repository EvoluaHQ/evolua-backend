import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EvoluaStackProps } from './evolua-stack-props';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  props: EvoluaStackProps;
  usersTable: dynamodb.Table;
  eventsTable: dynamodb.Table;
  reposTable: dynamodb.Table;
  scansTable: dynamodb.Table;
  eventBus: events.EventBus;
  dataRemovalPolicy: cdk.RemovalPolicy;

  constructor(scope: Construct, id: string, props: EvoluaStackProps) {
    super(scope, id);

    this.props = props;

    this.dataRemovalPolicy = this.props.stageName === "prod" 
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    this.usersTable = this.createUsersTable();
    this.createTableParameters('UsersTable', this.usersTable, 'users-table');

    this.eventsTable = this.createEventsTable();
    this.createTableParameters('EventsTable', this.eventsTable, 'events-table');

    this.reposTable = this.createReposTable();
    this.createTableParameters('ReposTable', this.reposTable, 'repos-table');

    this.scansTable = this.createScansTable();
    this.createTableParameters('ScanResultsTable', this.scansTable, 'scans-table');

    this.eventBus = this.createEventBus();
    new ssm.StringParameter(this, 'EventBusName', {
      parameterName: `/evolua/${props.stageName}/event-bus/name`,
      stringValue: this.eventBus.eventBusName,
    });
    new ssm.StringParameter(this, 'EventBusArn', {
      parameterName: `/evolua/${props.stageName}/event-bus/arn`,
      stringValue: this.eventBus.eventBusArn,
    });

    this.createGitHubPrOpenedEventHandlerFunction();

    this.createClerkUserUpsertedEventHandlerFunction();
    this.createClerkUserDeletedEventHandlerFunction();

    new cdk.CfnOutput(this, 'SSM_STAGE_NAME', {
      key: 'SsmStageName',
      value: this.props.ssmStageName
    });

    new cdk.CfnOutput(this, 'AWS_REGION', {
      key: 'AwsRegion',
      value: cdk.Aws.REGION
    });

    new cdk.CfnOutput(this, 'SCANS_TABLE_NAME', {
      key: 'ScansTableName',
      value: this.scansTable.tableName
    });
  }

  private createEventBus(): events.EventBus {
    return new events.EventBus(this, 'EventBus', {
      eventBusName: `evolua-events-${this.props.stageName}`,
    });
  }

  private createUsersTable(): dynamodb.Table {
    const table = new dynamodb.Table(this, 'UsersTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy
    });

    table.addGlobalSecondaryIndex({
      indexName: 'emailIndex',
      partitionKey: {
        name: 'email',
        type: dynamodb.AttributeType.STRING,
      },
    });

    table.addGlobalSecondaryIndex({
      indexName: 'clerkUserIdIndex',
      partitionKey: {
        name: 'clerkUserId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    table.addGlobalSecondaryIndex({
      indexName: 'githubHandleIndex',
      partitionKey: {
        name: 'githubHandle',
        type: dynamodb.AttributeType.STRING,
      },
    });

    return table;
  }

  private createEventsTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'EventsTable', {
      partitionKey: {
        name: 'source',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'eventId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy
    });
  }

  private createReposTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'ReposTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'repoId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy
    });
  }

  private createScansTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'ScansTable', {
      partitionKey: {
        name: 'repoId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: this.dataRemovalPolicy
    });
  }

  private createTableParameters(id: string, table: dynamodb.Table, ssmPath: string) {
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
      stringValue: table.tableStreamArn || '',
    });
  }

  private createGitHubPrOpenedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(this, 'GitHubPrOpenedHandlerFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/github-pr-opened.js',
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      environment: {
        SCANS_TABLE_NAME: this.scansTable.tableName,
        STAGE_NAME: this.props.stageName,
        SSM_STAGE_NAME: this.props.ssmStageName,
      }
    });    

    // add EventBridge event source for the githubHandler function    
    const ghWebhookRule = new events.Rule(this, 'GithubPrRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detail: {
          metadata: {
            type: ['pull_request.opened'],
          }
        }
      }
    });
    ghWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter*'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/github/app-id`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/github/private-key`,
      ],
    }));

    handler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [ '*' ]
    }));

    this.scansTable.grantWriteData(handler);
  }

  private createClerkUserUpsertedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(this, 'ClerkUserUpsertedHandlerFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/clerk-user-upserted.js',
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(6),
      environment: {
        USERS_TABLE_NAME: this.usersTable.tableName
      }
    });    

    const clerkWebhookRule = new events.Rule(this, 'ClerkUserUpserted', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['clerk'],
        detail: {
          metadata: {
            type: ['user.created', 'user.updated']
          }
        }
      }
    });
    clerkWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.usersTable.grantReadWriteData(handler);
  }

  private createClerkUserDeletedEventHandlerFunction() {
    const handler = new lambda.NodejsFunction(this, 'ClerkUserDeletedHandlerFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/clerk-user-deleted.js',
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(6),
      environment: {
        USERS_TABLE_NAME: this.usersTable.tableName
      }
    });    

    const clerkWebhookRule = new events.Rule(this, 'ClerkUserDeleted', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['clerk'],
        detail: {
          metadata: {
            type: ['user.deleted']
          }
        }
      }
    });
    clerkWebhookRule.addTarget(new eventTargets.LambdaFunction(handler));

    this.usersTable.grantReadWriteData(handler);
  }
}
