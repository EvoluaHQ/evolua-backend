#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EvoluaApiStack } from './constructs/evolua-api-stack';
import { CommonLambdaEnvVars } from './aspects/lambda';

const app = new cdk.App();

let stageName = app.node.tryGetContext('stageName');
let ssmStageName = app.node.tryGetContext('ssmStageName');

if (!stageName) {
  console.log('Defaulting stage name to dev');
  stageName = 'dev';
}

if (!ssmStageName) {
  console.log(`Defaulting SSM stage name to "stageName": ${stageName}`);
  ssmStageName = stageName;
}

const serviceName = 'evolua-api';

new EvoluaApiStack(app, `EvoluaApiStack-${stageName}`, {
  serviceName,
  stageName,
  ssmStageName,
});

cdk.Aspects.of(app).add(new CommonLambdaEnvVars(serviceName, stageName, ssmStageName));
