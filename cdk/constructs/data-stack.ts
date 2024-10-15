import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { EvoluaStackProps } from './evolua-stack-props';
import { Construct } from 'constructs';

export class DataStack extends cdk.Stack {
  props: EvoluaStackProps;

  constructor(scope: Construct, id: string, props: EvoluaStackProps) {
    super(scope, id);

    this.props = props;

    const usersTable = this.createUsersTable();
    this.createTableParameters('UsersTable', usersTable, 'users-table');

    const eventsTable = this.createEventsTable();
    this.createTableParameters('EventsTable', eventsTable, 'events-table');

    const eventBus = this.createEventBus();
    new ssm.StringParameter(this, 'EventBusName', {
      parameterName: `/evolua/${props.ssmStageName}/event-bus/name`,
      stringValue: eventBus.eventBusName,
    });
    new ssm.StringParameter(this, 'EventBusArn', {
      parameterName: `/evolua/${props.ssmStageName}/event-bus/arn`,
      stringValue: eventBus.eventBusArn,
    });
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
}