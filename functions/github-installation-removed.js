const Repos = require('./lib/repos');
const { GitHubInstallationEventDetail } = require('./types/eventbridge');

/**
 * @param {import('aws-lambda').EventBridgeEvent<'installation.removed', GitHubInstallationEventDetail>} event
 */
module.exports.handler = async (event, context) => {
  const reposAdded = event.detail.data.repositories_removed;
  const repos = reposAdded.map(x => ({
    provider: 'github',
    providerId: x.id,
    name: x.name,
    fullName: x.full_name,
    private: x.private,
  }))

  await Repos.deleteRepos(repos);
};
