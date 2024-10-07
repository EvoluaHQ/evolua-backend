import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { STAGE_NAMES } from '../constants';

export class EvoluaApiStackProps {
  serviceName: string;
  stageName: string;
  ssmStageName: string;
}

export class EvoluaApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EvoluaApiStackProps) {
    super(scope, id);

    const usersTable = this.createUsersTable();

    // create a authorizer lambda function
    const authorizerFunction = new lambda.NodejsFunction(this, 'Authorizer', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/authorizer.js',
      handler: 'handler',
      memorySize: 1024,
      environment: {
        JWKS_URI: 'https://dev-agq5zy2bqhbravbt.us.auth0.com/.well-known/jwks.json',
        AUDIENCE: 'https://dev.evolua.io/api',
        TOKEN_ISSUER: 'https://dev-agq5zy2bqhbravbt.us.auth0.com/',
        USERS_TABLE_NAME: usersTable.tableName,
      }
    });

    const api = new appsync.GraphqlApi(this, 'Api', {
      name: `${props.serviceName}-${props.stageName}`,
      definition: {
        schema: appsync.SchemaFile.fromAsset('schema.graphql'),
      },
      introspectionConfig: this.getIntrospectionConfig(props.stageName),
      logConfig: this.getLogConfig(props.stageName),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.LAMBDA,
          lambdaAuthorizerConfig: {
            handler: authorizerFunction,
            resultsCacheTtl: cdk.Duration.minutes(60),
          }
        },
      },
      xrayEnabled: true,
    });
  }

  private createUsersTable(): dynamodb.Table {
    return new dynamodb.Table(this, 'UsersTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
  }

  private getIntrospectionConfig(stageName: string): appsync.IntrospectionConfig {
    return stageName === STAGE_NAMES.PROD 
      ? appsync.IntrospectionConfig.DISABLED
      : appsync.IntrospectionConfig.ENABLED;
  }

  private getLogConfig(stageName: string): appsync.LogConfig {
    if (stageName === STAGE_NAMES.PROD) {
      return {
        fieldLogLevel: appsync.FieldLogLevel.INFO,
        excludeVerboseContent: true,
        retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      };
    } else {
      return {
        fieldLogLevel: appsync.FieldLogLevel.ALL,
        retention: cdk.aws_logs.RetentionDays.ONE_MONTH,
      };
    }
  }
}
