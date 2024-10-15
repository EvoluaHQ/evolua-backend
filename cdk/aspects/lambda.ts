import { IAspect } from "aws-cdk-lib";
import { Function } from 'aws-cdk-lib/aws-lambda';
import { IConstruct } from "constructs";
import { STAGE_NAMES } from "../constants";
import { 
  EvoluaStackProps, 
  EvoluaServiceStackProps
} from '../constructs/evolua-stack-props';

export class CommonLambdaEnvVars implements IAspect {
  serviceName: string;
  stageName: string;
  ssmStageName: string;

  constructor(props: EvoluaStackProps) {
    this.stageName = props.stageName;
    this.ssmStageName = props.ssmStageName;

    if (props instanceof EvoluaServiceStackProps) {
      this.serviceName = `${props.serviceName}-${this.stageName}`;
    }
  }

  public visit(node: IConstruct): void {
    if (node instanceof Function) {
      const logLevel = this.stageName === STAGE_NAMES.PROD ? 'INFO' : 'DEBUG';
      node.addEnvironment('POWERTOOLS_LOG_LEVEL', logLevel);
      
      if (this.serviceName) {
        node.addEnvironment('POWERTOOLS_SERVICE_NAME', this.serviceName);
      }

      node.addEnvironment('STAGE_NAME', this.stageName);
      node.addEnvironment('SSM_STAGE_NAME', this.ssmStageName);
    }
  }
}