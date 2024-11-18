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
  const repoIds = reposRemoved.map(x => `github#${x.id}`);

  await Repos.deleteRepos(repoIds);
};
