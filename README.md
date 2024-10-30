# Backend repo for the Evolua app

Consists of:

* An AppSync API used by the evolua frontend;
* An API Gateway REST API for webhooks (Clerk, GitHub);
* A data stack that owns the databases, event buses, etc.

To deploy to "dev", run
  `npx cdk deploy --all`

To deploy to another environment, say "prod", run
  `npx cdk deploy --all --context stageName=prod`.

For the main stages - `dev`, `staging` and `prod` - we will have a separate GitHub app. We will store secrets (e.g. GitHub secret, or private key) in SSM Parameter Store.

To avoid having to duplicate these for the temporary environments (created for each developer, or for specific features), we want to share these SSM parameters from the main stages.

To create a short-lived environment called `dev-yan` and reuse the SSM parameters from `dev`, run
  `npx cdk deploy --all --context stageName=yan --context ssmStageName=dev`

## Running tests locally

To run the test scripts, e.g. `test:unit`, you need to first create a `.env` file and capture the information the test needs.

To do this, execute the `export-env.sh` script with the name of your environment and region.
For dev, run `./export-env.sh dev us-east-1`

Make sure you have an active AWS credential or profile in the terminal session when you execute the script or run the tests.

