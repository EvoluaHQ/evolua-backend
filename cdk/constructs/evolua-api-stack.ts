import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { EvoluaServiceStackProps } from './evolua-stack-props';
import { Construct } from 'constructs';
import { STAGE_NAMES } from '../constants';

export class EvoluaApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EvoluaServiceStackProps) {
    super(scope, id);

    const usersTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/users-table/arn`);
    const usersTable = dynamodb.Table.fromTableArn(this, 'UsersTable', usersTableArn);

    const reposTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/repos-table/arn`);
    const reposTable = dynamodb.Table.fromTableArn(this, 'ReposTable', reposTableArn);

    const tenantReposTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/tenant-repos-table/arn`);
    const tenantReposTable = dynamodb.Table.fromTableArn(this, 'TenantReposTable', tenantReposTableArn);

    const scansTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/scans-table/arn`);
    const scansTable = dynamodb.Table.fromTableArn(this, 'ScansTable', scansTableArn);

    const scanResultsTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/scan-results-table/arn`);
    const scanResultsTable = dynamodb.Table.fromTableArn(this, 'ScanResultsTable', scanResultsTableArn);

    // create a authorizer lambda function
    const authorizerFunction = new lambda.NodejsFunction(this, 'Authorizer', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_20_X,
      entry: 'functions/authorizer.js',
      handler: 'handler',
      memorySize: 1024,
      environment: {
        USERS_TABLE_NAME: usersTable.tableName,
      }
    });
    authorizerFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${usersTable.tableArn}/index/clerkUserIdIndex`],
    }));

    const graphQlApi = new appsync.GraphqlApi(this, 'Api', {
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
      environmentVariables: {
        USERS_TABLE_NAME: usersTable.tableName,
        REPOS_TABLE_NAME: reposTable.tableName,
        SCANS_TABLE_NAME: scansTable.tableName,
        SCAN_RESULTS_TABLE_NAME: scanResultsTable.tableName,
      }
    });

    const usersTableDataSource = graphQlApi.addDynamoDbDataSource('UsersTableDataSource', usersTable);
    const reposTableDataSource = graphQlApi.addDynamoDbDataSource('ReposTableDataSource', reposTable);
    const tenantReposTableDataSource = graphQlApi.addDynamoDbDataSource('TenantReposTableDataSource', tenantReposTable);
    const scansTableDataSource = graphQlApi.addDynamoDbDataSource('ScansTableDataSource', scansTable);
    const scanResultsTableDataSource = graphQlApi.addDynamoDbDataSource('ScanResultsTableDataSource', scanResultsTable);

    const listTenantReposFunction = new appsync.AppsyncFunction(this, 'ListTenantReposFunction', {
      api: graphQlApi,
      name: 'listTenantRepos',
      dataSource: tenantReposTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/func-list-tenant-repos.js'),
    });

    const hydrateTenantReposFunction = new appsync.AppsyncFunction(this, 'HydrateTenantReposFunction', {
      api: graphQlApi,
      name: 'hydrateTenantRepos',
      dataSource: reposTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/func-hydrate-tenant-repos.js')
    });

    graphQlApi.createResolver('QueryListReposResolver', {
      typeName: 'Query',
      fieldName: 'listRepos',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/query-list-repos.js'),
      pipelineConfig: [
        listTenantReposFunction,
        hydrateTenantReposFunction,
      ]
    });

    graphQlApi.createResolver('QueryListScansResolver', {
      typeName: 'Query',
      fieldName: 'listScans',
      dataSource: scansTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/query-list-scans.js'),
    });

    graphQlApi.createResolver('ScanResultsResolver', {
      typeName: 'Scan',
      fieldName: 'results',
      dataSource: scanResultsTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/scan-results.js'),
    });

    graphQlApi.createResolver('GetUsageResolver', {
      typeName: 'Query',
      fieldName: 'getUsage',
      dataSource: usersTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/query-get-usage.js'),
    });

    reposTable.grantReadData(reposTableDataSource);
    tenantReposTable.grantReadData(tenantReposTableDataSource);
    scansTable.grantReadData(scansTableDataSource);
    scanResultsTable.grantReadData(scanResultsTableDataSource);
    usersTable.grantReadData(usersTableDataSource);
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
