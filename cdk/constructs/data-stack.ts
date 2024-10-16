import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { EvoluaStackProps } from './evolua-stack-props';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  props: EvoluaStackProps;
  usersTable: dynamodb.Table;
  eventsTable: dynamodb.Table;
  eventBus: events.EventBus;  

  constructor(scope: Construct, id: string, props: EvoluaStackProps) {
    super(scope, id);

    this.props = props;

    this.usersTable = this.createUsersTable();
    this.createTableParameters('UsersTable', this.usersTable, 'users-table');

    this.eventsTable = this.createEventsTable();
    this.createTableParameters('EventsTable', this.eventsTable, 'events-table');

    this.eventBus = this.createEventBus();
    new ssm.StringParameter(this, 'EventBusName', {
      parameterName: `/evolua/${props.ssmStageName}/event-bus/name`,
      stringValue: this.eventBus.eventBusName,
    });
    new ssm.StringParameter(this, 'EventBusArn', {
      parameterName: `/evolua/${props.ssmStageName}/event-bus/arn`,
      stringValue: this.eventBus.eventBusArn,
    });

    this.createGitHubEventHandlerFunction();
  }

  private createEventBus(): events.EventBus {
    return new events.EventBus(this, 'EventBus', {
      eventBusName: `evolua-events-${this.props.stageName}`,
    });
  }

  private createUsersTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'UsersTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    });
  }

  private createEventsTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'EventsTable', {
      partitionKey: {
        name: 'tenantId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'eventId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
    });
  }

  private createTableParameters(id: string, table: dynamodb.Table, ssmPath: string) {
    new ssm.StringParameter(this, `${id}Name`, {
      parameterName: `/evolua/${this.props.ssmStageName}/dynamodb/${ssmPath}/name`,
      stringValue: table.tableName,
    });
    new ssm.StringParameter(this, `${id}Arn`, {
      parameterName: `/evolua/${this.props.ssmStageName}/dynamodb/${ssmPath}/arn`,
      stringValue: table.tableArn,
    });
    new ssm.StringParameter(this, `${id}StreamArn`, {
      parameterName: `/evolua/${this.props.ssmStageName}/dynamodb/${ssmPath}/stream-arn`,
      stringValue: table.tableStreamArn || '',
    });
  }

  private createGitHubEventHandlerFunction() {
    const githubHandler = new lambda.NodejsFunction(this, 'GitHubEventHandlerFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/github-event-handler.ts',
      handler: 'handler',
      memorySize: 1024,
      environment: {
      }
    });

    // add EventBridge event source for the githubHandler function    
    const ghWebhookRule = new events.Rule(this, 'GithubWebhookRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: ['webhook'],
      }
    });
    ghWebhookRule.addTarget(new eventTargets.LambdaFunction(githubHandler));
  }
}