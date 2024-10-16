import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { EvoluaServiceStackProps } from './evolua-stack-props';
import { Construct } from 'constructs';

export class EvoluaWebhookStack extends cdk.Stack {
  props: EvoluaServiceStackProps;
  usersTable: dynamodb.ITable;
  eventsTable: dynamodb.ITable;
  eventBus: events.IEventBus;
  api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: EvoluaServiceStackProps) {
    super(scope, id);

    this.props = props;

    const usersTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/users-table/arn`);
    this.usersTable = dynamodb.Table.fromTableArn(this, 'UsersTable', usersTableArn);
    const eventsTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/events-table/arn`);
    this.eventsTable = dynamodb.Table.fromTableArn(this, 'EventsTable', eventsTableArn);

    const eventBusArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/event-bus/arn`);
    this.eventBus = events.EventBus.fromEventBusArn(this, 'EventBus', eventBusArn);

    this.api = new apigateway.RestApi(this, 'WebhookApi', {
      restApiName: `${props.serviceName}-${props.stageName}`,
      deployOptions: {
        stageName: props.stageName
      }
    });

    this.createClerkWebhook();
    this.createGitHubWebhook();
  }

  private createClerkWebhook() {
    const webhookFunction = new lambda.NodejsFunction(this, 'ClerkWebhookFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/clerk-webhook.js',
      handler: 'handler',
      memorySize: 1024,
      environment: {
        EVENTS_TABLE_NAME: this.eventsTable.tableName,
        USERS_TABLE_NAME: this.usersTable.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      }
    });

    this.usersTable.grantReadWriteData(webhookFunction);
    this.eventsTable.grantWriteData(webhookFunction);
    this.eventBus.grantPutEventsTo(webhookFunction);

    // set up the POST /clerk endpoint with an API key as a shared secret
    // between the Clerk service and the webhook
    const clerkResource = this.api.root.addResource('clerk');
    const apiKey = this.api.addApiKey('ClerkApiKey', {
      apiKeyName: `ClerkApiKey-${this.props.stageName}`,
    });
    const plan = this.api.addUsagePlan('ClerkUsagePlan', {
      name: `Clerk-${this.props.stageName}`,
      apiStages: [{
        api: this.api,
        stage: this.api.deploymentStage,
      }],
    });
    plan.addApiKey(apiKey);

    clerkResource.addMethod('POST', new apigateway.LambdaIntegration(webhookFunction), {
      apiKeyRequired: true,
    });
  }

  private createGitHubWebhook() {
    const webhookFunction = new lambda.NodejsFunction(this, 'GitHubWebhookFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/github-webhook.js',
      handler: 'handler',
      memorySize: 1024,
      environment: {
        EVENTS_TABLE_NAME: this.eventsTable.tableName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      }
    });

    this.eventsTable.grantWriteData(webhookFunction);
    this.eventBus.grantPutEventsTo(webhookFunction);

    // set up the POST /github endpoint
    const githubResource = this.api.root.addResource('github');
    githubResource.addMethod('POST', new apigateway.LambdaIntegration(webhookFunction));

    // we need to validate the webhook with a GitHub secret in SSM parameter store
    // see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
    webhookFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter*'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/github/secret`]
    }))
  }
}
