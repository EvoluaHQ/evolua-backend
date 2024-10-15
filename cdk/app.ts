#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from './constructs/data-stack';
import { EvoluaApiStack } from './constructs/evolua-api-stack';
import { EvoluaWebhookStack } from './constructs/evolua-webhook-stack';
import { CommonLambdaEnvVars } from './aspects/lambda';
import { EvoluaServiceStackProps } from './constructs/evolua-stack-props';

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

new DataStack(app, `EvoluaDataStack-${stageName}`, {
  stageName,
  ssmStageName,
});

const apiStackProps: EvoluaServiceStackProps = {
  serviceName: 'evolua-api',
  stageName,
  ssmStageName,
};
const apiStack = new EvoluaApiStack(app, `EvoluaApiStack-${stageName}`, apiStackProps);
cdk.Aspects.of(apiStack).add(new CommonLambdaEnvVars(apiStackProps));

const webhookStackProps: EvoluaServiceStackProps = {
  serviceName: 'evolua-webhook',
  stageName,
  ssmStageName,
};
const webhookStack = new EvoluaWebhookStack(app, `EvoluaWebhookStack-${stageName}`, webhookStackProps);
cdk.Aspects.of(webhookStack).add(new CommonLambdaEnvVars(webhookStackProps));
