import { EventBridgeEvent } from 'aws-lambda';

export interface GitHubEventDetail {
  metadata: {
    eventId: string,
    version: string,
    timestamp: string,
    type: string,      
  },
  data: any // payload from the GitHub webhook
}

export const handler = async (event: EventBridgeEvent<'webhook', GitHubEventDetail>) => {
  const detail = event.detail;
  
  // business logic here
};