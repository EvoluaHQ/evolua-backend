#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from './constructs/data-stack';
import { EvoluaApiStack } from './constructs/evolua-api-stack';
import { EvoluaWebhookStack } from './constructs/evolua-webhook-stack';
import { CommonLambdaEnvVars } from './aspects/lambda';
import { EvoluaServiceStackProps } from './constructs/evolua-stack-props';

const app = new cdk.App();

// use stage name to create new environments
// e.g. dev, staging, prod for the main environments
// and dev-yan, dev-sam for environments for developers
// or dev-feature, or dev-ci for short-lived environments
let stageName = app.node.tryGetContext('stageName');

// use SSM stage name to allow temporary environments to
// share SSM parameters from the main stages, for things like
// GitHub app id, secret, etc. so we don't have to duplicate
// these parameters for each temporary environment
let ssmStageName = app.node.tryGetContext('ssmStageName');

// to set these environments during deployment, use --context flag
// e.g. npx cdk deploy --context stageName=dev-yan --context ssmStageName=dev
// this creates a new environment called "dev-yan", but uses the SSM
// parameters from the "dev" environment

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
