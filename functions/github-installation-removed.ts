import * as Repos from './lib/repos';
import { EventBridgeEvent } from 'aws-lambda';
import { ReposChangedInput } from './types/github';
import { Metadata } from './types/eventbridge';

type EventEnvelope = {
  metadata: Metadata;
  data: ReposChangedInput;
}
type Event = EventBridgeEvent<'repos_uninstalled', EventEnvelope>;

export const handler = async (event: Event) => {
  const reposRemoved = event.detail.data.repositories;
  const repos = reposRemoved.map(x => ({
    provider: 'github',
    providerId: x.id.toString(),
    name: x.name,
    fullName: x.full_name,
    private: x.private,
  }));

  await Repos.deleteRepos(repos);
};
