import * as cdk from 'aws-cdk-lib';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { EvoluaServiceStackProps } from './evolua-stack-props';
import { TypescriptFunction } from './typescript-function';
import { Construct } from 'constructs';
import { STAGE_NAMES } from '../constants';

export class EvoluaApiStack extends cdk.Stack {
  props: EvoluaServiceStackProps;
  usersTable: dynamodb.ITable;
  reposTable: dynamodb.ITable;
  tenantReposTable: dynamodb.ITable;
  scansTable: dynamodb.ITable;
  scanResultsTable: dynamodb.ITable;

  constructor(scope: Construct, id: string, props: EvoluaServiceStackProps) {
    super(scope, id);

    this.props = props;

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
    const getRepoStatsFunction = this.createGetRepoStatsFunction();
    const searchReposFunction = this.createSearchReposFunction();
    const searchScansFunction = this.createSearchScansFunction();

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
    const getRepoStatsDataSource = graphQlApi.addLambdaDataSource('GetRepoStatsDataSource', getRepoStatsFunction);
    const searchReposDataSource = graphQlApi.addLambdaDataSource('SearchReposDataSource', searchReposFunction);
    const searchScansDataSource = graphQlApi.addLambdaDataSource('SearchScansDataSource', searchScansFunction);

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

    const hydrateTenantRepoFunction = new appsync.AppsyncFunction(this, 'HydrateTenantRepoFunction', {
      api: graphQlApi,
      name: 'hydrateTenantRepo',
      dataSource: reposTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/func-hydrate-tenant-repo.js')
    });

    const getRepoByTenantRepoIdFunction = new appsync.AppsyncFunction(this, 'GetRepoByTenantRepoIdFunction', {
      api: graphQlApi,
      name: 'getRepoByTenantRepoIdFunction',
      dataSource: tenantReposTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/func-get-repo-by-tenantRepoId.js')
    });

    const listScansFunction = new appsync.AppsyncFunction(this, 'ListScansFunction', {
      api: graphQlApi,
      name: 'listScansFunction',
      dataSource: scansTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/func-list-scans.js')
    });

    const getScanFunction = new appsync.AppsyncFunction(this, 'GetScanFunction', {
      api: graphQlApi,
      name: 'getScanFunction',
      dataSource: scansTableDataSource,
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/func-get-scan.js')
    });

    graphQlApi.createResolver('QueryListReposResolver', {
      typeName: 'Query',
      fieldName: 'listRepos',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/default-pipeline.js'),
      pipelineConfig: [
        listTenantReposFunction,
        hydrateTenantReposFunction,
      ]
    });

    graphQlApi.createResolver('QueryGetRepoResolver', {
      typeName: 'Query',
      fieldName: 'getRepo',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/default-pipeline.js'),
      pipelineConfig: [
        getRepoByTenantRepoIdFunction,
        hydrateTenantRepoFunction,
      ]
    });

    graphQlApi.createResolver('QueryListScansResolver', {
      typeName: 'Query',
      fieldName: 'listScans',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/default-pipeline.js'),
      pipelineConfig: [
        getRepoByTenantRepoIdFunction,
        listScansFunction,
      ]
    });

    graphQlApi.createResolver('QueryGetScansResolver', {
      typeName: 'Query',
      fieldName: 'getScan',
      runtime: appsync.FunctionRuntime.JS_1_0_0,
      code: appsync.Code.fromAsset('appsync-resolvers/default-pipeline.js'),
      pipelineConfig: [
        getRepoByTenantRepoIdFunction,
        getScanFunction,
      ]
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

    getRepoStatsDataSource.createResolver('GetRepoStatsResolver', {
      typeName: 'Query',
      fieldName: 'getRepoStats',
    });

    searchReposDataSource.createResolver('SearchReposResolver', {
      typeName: 'Query',
      fieldName: 'searchRepos',
    });

    searchScansDataSource.createResolver('SearchScansResolver', {
      typeName: 'Query',
      fieldName: 'searchScans',
    });

    this.reposTable.grantReadData(reposTableDataSource);
    this.tenantReposTable.grantReadData(tenantReposTableDataSource);
    tenantReposTableDataSource.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.tenantReposTable.tableArn}/index/tenantRepoIdIndex`],
    }));    
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
    const getStats = new TypescriptFunction(this, 'GetStatsFunction', {
      serviceName: this.props.serviceName,
      stageName: this.props.stageName,
      ssmStageName: this.props.ssmStageName,
      entry: 'functions/get-stats.ts',
      timeout: cdk.Duration.seconds(20),
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

  private createGetRepoStatsFunction() {
    const getRepoStats = new TypescriptFunction(this, 'GetRepoStatsFunction', {
      serviceName: this.props.serviceName,
      stageName: this.props.stageName,
      ssmStageName: this.props.ssmStageName,
      entry: 'functions/get-repo-stats.ts',
      timeout: cdk.Duration.seconds(20),
      handler: 'handler',
      environment: {
        TENANT_REPOS_TABLE_NAME: this.tenantReposTable.tableName,
        SCANS_TABLE_NAME: this.scansTable.tableName,
      }
    });

    this.tenantReposTable.grantReadData(getRepoStats);
    this.scansTable.grantReadData(getRepoStats);

    getRepoStats.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.tenantReposTable.tableArn}/index/tenantRepoIdIndex`],
    }));

    getRepoStats.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.scansTable.tableArn}/index/byTimestampIndex`],
    }));

    return getRepoStats;
  }

  private createSearchReposFunction() {
    const searchRepos = new TypescriptFunction(this, 'SearchReposFunction', {
      serviceName: this.props.serviceName,
      stageName: this.props.stageName,
      ssmStageName: this.props.ssmStageName,
      entry: 'functions/search-repos.ts',
      timeout: cdk.Duration.seconds(6),
      handler: 'handler',
      environment: {
        REPOS_TABLE_NAME: this.reposTable.tableName,
      }
    });

    this.reposTable.grantReadData(searchRepos);

    searchRepos.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter*"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/app-id`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/search-api-key`
        ],
      })
    );

    return searchRepos;
  }

  private createSearchScansFunction() {
    const searchScans = new TypescriptFunction(this, 'SearchScansFunction', {
      serviceName: this.props.serviceName,
      stageName: this.props.stageName,
      ssmStageName: this.props.ssmStageName,
      entry: 'functions/search-scans.ts',
      timeout: cdk.Duration.seconds(6),
      handler: 'handler',
      environment: {
        TENANT_REPOS_TABLE_NAME: this.tenantReposTable.tableName,
      }
    });

    searchScans.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${this.tenantReposTable.tableArn}/index/tenantRepoIdIndex`],
    }));

    searchScans.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter*"],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/app-id`,
          `arn:aws:ssm:${this.region}:${this.account}:parameter/evolua/${this.props.ssmStageName}/algolia/search-api-key`
        ],
      })
    );

    return searchScans;
  }
}
