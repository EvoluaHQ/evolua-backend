const Users = require('./lib/users');
const Repos = require('./lib/repos');
const { GitHubInstallationEventDetail } = require('./github-webhook.event');
const { Logger } = require('@aws-lambda-powertools/logger');
const logger = new Logger();

/**
 * @param {import('aws-lambda').EventBridgeEvent<'installation.added', GitHubInstallationEventDetail>} event
 */
module.exports.handler = async (event, context) => {
  const reposAdded = event.detail.data.repositories_added;
  const repos = reposAdded.map(x => ({
    provider: 'github',
    providerId: x.id,
    name: x.name,
    fullName: x.full_name,
    private: x.private,
  }))

  const todos = [];

  todos.push(Repos.saveRepos(repos));

  const githubHandle = event.detail.data.sender.login;

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
