import { APIGatewayEvent } from 'aws-lambda';
import { Webhooks } from '@octokit/webhooks';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import * as ulid from 'ulid';
import * as Events from './lib/events';
import { GH_PR_ACTIONS, GH_INSTALL_ACTIONS } from './lib/constants';
import { Logger } from '@aws-lambda-powertools/logger';
import { ScanGitHubPrInput } from './types/github';

const { SSM_STAGE_NAME } = process.env;

const logger = new Logger();

interface PullRequest {
  id: number
  number: number
  node_id: string
  url: string
  title: string
  created_at: string
  owner: { login: string }
}

interface Repository {
  id: number
  name: string
  full_name: string
  owner: { login: string }
}

interface GithubPayload {
  action?: string;
  pull_request?: PullRequest;
  repository?: Repository;
  installation?: { id: number };
  sender?: { login: string };
  issue?: {
    pull_request?: {
      url: string
    }
  };
  comment?: object & { body: string };
}

const SUCCESS_RESPONSE = {
  statusCode: 200,
  body: ""
};

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

  let eventCategory = 'uncategorized';
  let action = payload.action || '';

  if (payload.pull_request && GH_PR_ACTIONS.includes(action)) {
    eventCategory = 'pull_request';

    if (action === 'opened') {
      const input: ScanGitHubPrInput = {
        reason: 'pull_request.opened',
        installation_id: payload.installation!.id,
        sender_login: payload.sender!.login,
        pull_request_number: payload.pull_request.number,
        repository: {
          id: payload.repository!.id,
          name: payload.repository!.name,
          full_name: payload.repository!.full_name,
          owner_login: payload.repository!.owner.login,
        }
      };

      const eventId = ulid.ulid();
      await Events.publishEvent(eventId, 'github', 'scan_triggered', input);
      await Events.saveEvent(eventId, 'github', 'scan_triggered', input);
    }
  } else if (payload.installation && GH_INSTALL_ACTIONS.includes(action)) {
    eventCategory = 'installation';
  } else if (payload.comment?.body.startsWith('/evolua-review') && payload.issue && action === 'created') 
  {
    eventCategory = 'evolua-command';
    action = 'review';

    // there are two types of comment events: issue_comment and pull_request_review_comment
    // see example/github folder for example payload
    // we only care about issue comments (i.e. if you type in the comment box on the PR page)

    const prNumber = payload.issue.pull_request!.url.split('/').pop() as string;

    const input: ScanGitHubPrInput = {
      reason: '/evolua-review',
      installation_id: payload.installation!.id,
      sender_login: payload.sender!.login,
      pull_request_number: parseInt(prNumber),
      repository: {
        id: payload.repository!.id,
        name: payload.repository!.name,
        full_name: payload.repository!.full_name,
        owner_login: payload.repository!.owner.login,
      }
    };

    const eventId = ulid.ulid();

    await Events.publishEvent(eventId, 'github', 'scan_triggered', input);
    await Events.saveEvent(eventId, 'github', 'scan_triggered', input);
  } else if (payload.comment) {
    // we don't want to track comments that are not commands
    // otherwise we would be tracking a lot of noise, including our own comments!
    logger.info(`Ignoring comment event that are not commands`);

    return SUCCESS_RESPONSE;
  }

  const eventType = `${eventCategory}.${action}`;

  const eventId = ulid.ulid();
  await Events.publishEvent(eventId, 'github', eventType, payload);
  await Events.saveEvent(eventId, 'github', eventType, payload);

  return SUCCESS_RESPONSE;
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
