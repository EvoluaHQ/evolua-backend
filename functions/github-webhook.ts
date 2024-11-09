import { APIGatewayEvent, Context } from 'aws-lambda';
import { Webhooks } from '@octokit/webhooks';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import * as ulid from 'ulid';
import * as Events from './lib/events';
import { GH_PR_ACTIONS, GH_INSTALL_ACTIONS } from './lib/constants';

const { SSM_STAGE_NAME } = process.env;

interface GithubPayload {
  action?: string;
  pull_request?: object;
  installation?: object;
}

const _handler = async (event: APIGatewayEvent, context: any) => {
  const webhooks = new Webhooks({
    secret: context.GITHUB_SECRET,
  });

  const signature = event.headers["X-Hub-Signature-256"];
  if (!signature) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        message: "X-Hub-Signature-256 header is missing"
      })
    };
  }

  if (!(await webhooks.verify(event.body || '', signature))) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        message: "Invalid signature"
      })
    };
  }

  const payload: GithubPayload = event.body ? JSON.parse(event.body) : {};
  const eventId = ulid.ulid();

  let eventCategory = 'uncategorized';
  if (payload.pull_request && GH_PR_ACTIONS.includes(payload.action || '')) {
    eventCategory = 'pull_request';
  } else if (payload.installation && GH_INSTALL_ACTIONS.includes(payload.action || '')) {
    eventCategory = 'installation';
  }

  const eventType = `${eventCategory}.${payload.action}`;

  await Events.publishEvent(eventId, 'github', eventType, payload);
  await Events.saveEvent(eventId, 'github', eventType, payload);

  return {
    statusCode: 200,
    body: ""
  };
}

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      GITHUB_SECRET: `/evolua/${SSM_STAGE_NAME}/github/secret`
    }
  }));
