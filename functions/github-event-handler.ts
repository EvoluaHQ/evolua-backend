import { EventBridgeEvent } from 'aws-lambda';

interface GitHubEventDetail {
  metadata: {
    eventId: string,
    version: string,
    timestamp: string,
    type: string,      
  },
  data: any  
}

export const handler = async (event: EventBridgeEvent<'MyEventType', GitHubEventDetail>) => {
  const detail = event.detail;
  
  // business logic here
};