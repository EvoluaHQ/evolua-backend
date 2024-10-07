import { IAspect } from "aws-cdk-lib";
import { Function } from 'aws-cdk-lib/aws-lambda';
import { IConstruct } from "constructs";
import { STAGE_NAMES } from "../constants";

export class CommonLambdaEnvVars implements IAspect {
  serviceName: string;
  stageName: string;
  ssmStageName: string;

  constructor(serviceName: string, stageName: string, ssmStageName: string) {
    this.serviceName = serviceName;
    this.stageName = stageName;
    this.ssmStageName = ssmStageName;
  }

  public visit(node: IConstruct): void {
    if (node instanceof Function) {
      const logLevel = this.stageName === STAGE_NAMES.PROD ? 'INFO' : 'DEBUG';
      node.addEnvironment('POWERTOOLS_LOG_LEVEL', logLevel);
      node.addEnvironment('SERVICE_NAME', this.serviceName);
      node.addEnvironment('STAGE_NAME', this.stageName);
      node.addEnvironment('SSM_STAGE_NAME', this.ssmStageName);
    }
  }
}