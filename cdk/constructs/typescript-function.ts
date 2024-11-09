import { Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';

export interface TypescriptFunctionProps extends NodejsFunctionProps {
  serviceName: string;
  stageName: string;
  ssmStageName: string;

  /**
   * The amount of memory, in MB, that is allocated to your Lambda function.
   * Lambda uses this value to proportionally allocate the amount of CPU
   * power. For more information, see Resource Model in the AWS Lambda
   * Developer Guide.
   *
   * @default 1024
   */
  readonly memorySize?: number;

  /**
     * The runtime environment. Only runtimes of the Node.js family are
     * supported.
     *
     * @default `Runtime.NODEJS_20_X`
     */
  readonly runtime?: lambda.Runtime;

  /**
     * The function execution time (in seconds) after which Lambda terminates
     * the function. Because the execution time affects cost, set this value
     * based on the function's expected execution time.
     *
     * @default Duration.seconds(6)
     */
  readonly timeout?: Duration;
}

export class TypescriptFunction extends NodejsFunction {
  public readonly lambdaFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: TypescriptFunctionProps) {
    const logLevel = props.stageName === 'prod' ? 'INFO' : 'DEBUG';

    const envVars = {
      ...props.environment,
      SERVICE_NAME: props.serviceName,
      STAGE_NAME: props.stageName,
      SSM_STAGE_NAME: props.ssmStageName,
      POWERTOOLS_SERVICE_NAME: props.serviceName, // for the Lambda powertools logger
      POWERTOOLS_LOG_LEVEL: logLevel
    };

    const nodejsFunctionProps: NodejsFunctionProps = {
      ...props,
      runtime: props.runtime || lambda.Runtime.NODEJS_20_X,
      memorySize: props.memorySize || 1024,
      timeout: props.timeout || Duration.seconds(6),
      environment: envVars,
      bundling: props.bundling || {
        minify: true,     // Minify code for production
        sourceMap: false, // Include source maps for better debugging
        externalModules: [
          // Modules that should be excluded from bundling
          "aws-sdk", // AWS SDK is available in the Lambda runtime
        ],
        target: "node20", // Target Node.js version
      },
    };

    super(scope, id, nodejsFunctionProps);
  }
}