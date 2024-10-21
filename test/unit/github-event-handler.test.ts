import { handler, GitHubEventDetail } from '../../functions/github-event-handler';
import { EventBridgeEvent } from 'aws-lambda';

describe('GitHub Event Handler', () => {
  function newGitHubEvent(data: any): EventBridgeEvent<'webhook', GitHubEventDetail> {
    return {
      id: '1',
      version: '1',
      account: '123456789012',
      time: '2023-01-01T00:00:00Z',
      region: 'us-east-1',
      resources: [],
      source: 'github',
      'detail-type': 'webhook',
      detail: {
        metadata: {
          eventId: '1',
          version: '1',
          timestamp: '2023-01-01T00:00:00Z',
          type: 'pull_request',
        },
        data
      }
    }
  };

  it('should handle PR created event', async () => {
    const event = newGitHubEvent({
      // PR data
    })

    const result = await handler(event);
    // Add assertions based on your business logic
  });

  it('should handle PR closed event', async () => {
    const event = newGitHubEvent({
      // PR data
    })

    const result = await handler(event);
    // Add assertions based on your business logic
  });

  it('should handle PR updated event', async () => {
    const event = newGitHubEvent({
      // PR data
    })

    const result = await handler(event);
    // Add assertions based on your business logic
  });
});