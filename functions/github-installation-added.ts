import { Logger } from '@aws-lambda-powertools/logger';
import * as Users from './lib/users';
import * as Repos from './lib/repos';
import { EventBridgeEvent } from 'aws-lambda';
import { ReposChangedInput } from './types/github';
import { Metadata } from './types/eventbridge';
import * as Ulid from 'ulid';

type EventEnvelope = {
  metadata: Metadata;
  data: ReposChangedInput;
}
type Event = EventBridgeEvent<'repos_installed', EventEnvelope>;

const logger = new Logger();

export const handler = async (event: Event): Promise<void> => {
  const reposAdded = event.detail.data.repositories;
  const repos = reposAdded.map(x => ({
    provider: 'github',
    providerRepoId: x.id.toString(),
    evoluaRepoId: Ulid.ulid(),
    name: x.name,
    fullName: x.full_name,
    private: x.private,
  }));

  const todos: Promise<any>[] = [];

  todos.push(Repos.saveRepos(repos));

  const githubHandle = event.detail.data.sender_login;

  const user = await Users.findUserByGithubHandle(githubHandle);

  if (user) {
    todos.push(Repos.enableReposForTenant(user.id, repos));
  } else {
    logger.warn('User not found by github handle', { 
      githubHandle
    });
  }

  await Promise.all(todos);
};
