import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EvoluaServiceStackProps } from './evolua-stack-props';
import { Construct } from 'constructs';
import { STAGE_NAMES } from '../constants';

export class EvoluaApiStack extends cdk.Stack {
  usersTable: dynamodb.ITable;
  reposTable: dynamodb.ITable;
  tenantReposTable: dynamodb.ITable;
  scansTable: dynamodb.ITable;
  scanResultsTable: dynamodb.ITable;

  constructor(scope: Construct, id: string, props: EvoluaServiceStackProps) {
    super(scope, id);

    const usersTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/users-table/arn`);
    this.usersTable = dynamodb.Table.fromTableArn(this, 'UsersTable', usersTableArn);

    const reposTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/repos-table/arn`);
    this.reposTable = dynamodb.Table.fromTableArn(this, 'ReposTable', reposTableArn);

    const tenantReposTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/tenant-repos-table/arn`);
    this.tenantReposTable = dynamodb.Table.fromTableArn(this, 'TenantReposTable', tenantReposTableArn);

    const scansTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/scans-table/arn`);
    this.scansTable = dynamodb.Table.fromTableArn(this, 'ScansTable', scansTableArn);

    const scanResultsTableArn = ssm.StringParameter.valueForStringParameter(
      this, `/evolua/${props.ssmStageName}/dynamodb/scan-results-table/arn`);
    this.scanResultsTable = dynamodb.Table.fromTableArn(this, 'ScanResultsTable', scanResultsTableArn);

    const authorizerFunction = this.createAuthorizerFunction();

    const getStatsFunction = this.createGetStatsFunction();

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
        USERS_TABLE_NAME: this.usersTable.tableName,
        REPOS_TABLE_NAME: this.reposTable.tableName,
        TENANT_REPOS_TABLE_NAME: this.tenantReposTable.tableName,
        SCANS_TABLE_NAME: this.scansTable.tableName,
        SCAN_RESULTS_TABLE_NAME: this.scanResultsTable.tableName,
      }
    });

    const usersTableDataSource = graphQlApi.addDynamoDbDataSource('UsersTableDataSource', this.usersTable);
    const reposTableDataSource = graphQlApi.addDynamoDbDataSource('ReposTableDataSource', this.reposTable);
    const tenantReposTableDataSource = graphQlApi.addDynamoDbDataSource('TenantReposTableDataSource', this.tenantReposTable);
    const scansTableDataSource = graphQlApi.addDynamoDbDataSource('ScansTableDataSource', this.scansTable);
    const scanResultsTableDataSource = graphQlApi.addDynamoDbDataSource('ScanResultsTableDataSource', this.scanResultsTable);
    const getStatsDataSource = graphQlApi.addLambdaDataSource('GetStatsDataSource', getStatsFunction);

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

    getStatsDataSource.createResolver('GetStatsResolver', {
      typeName: 'Query',
      fieldName: 'getStats',
    });

    this.reposTable.grantReadData(reposTableDataSource);
    this.tenantReposTable.grantReadData(tenantReposTableDataSource);
    this.scansTable.grantReadData(scansTableDataSource);
    this.scanResultsTable.grantReadData(scanResultsTableDataSource);
    this.usersTable.grantReadData(usersTableDataSource);
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

  private createAuthorizerFunction() {
    const authorizer = new lambdaNodejs.NodejsFunction(this, 'Authorizer', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'functions/authorizer.js',
      handler: 'handler',
      memorySize: 1024,
      environment: {
        USERS_TABLE_NAME: this.usersTable.tableName,
      }
    });

    authorizer.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.usersTable.tableArn}/index/clerkUserIdIndex`],
    }));

    return authorizer;
  }

  private createGetStatsFunction() {
    const getStats = new lambdaNodejs.NodejsFunction(this, 'GetStatsFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'functions/get-stats.ts',
      handler: 'handler',
      environment: {
        TENANT_REPOS_TABLE_NAME: this.tenantReposTable.tableName,
        SCANS_TABLE_NAME: this.scansTable.tableName,
      }
    });

    this.tenantReposTable.grantReadData(getStats);
    this.scansTable.grantReadData(getStats);

    getStats.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.scansTable.tableArn}/index/byTimestampIndex`],
    }));

    return getStats;
  }
}
