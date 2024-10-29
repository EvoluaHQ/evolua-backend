// for availabel GitHub events
// see https://docs.github.com/en/rest/using-the-rest-api/github-event-types
const GH_PR_ACTIONS = [
  'opened', 
  'edited', 
  'closed', 
  'reopened', 
  'assigned', 
  'unassigned', 
  'review_requested', 
  'review_request_removed', 
  'labeled', 
  'unlabeled'
];
const GH_PR_REVIEW_ACTIONS = [ 'created' ];
const GH_PR_REVIEW_COMMENT_ACTIONS = [ 'created' ];
const GH_PR_REVIEW_THREAD_ACTIONS = [ 'resolved', 'unresolved' ];
const GH_INSTALL_ACTIONS = [
  'added', 
  'removed'
];

module.exports = {
  GH_PR_ACTIONS,
  GH_PR_REVIEW_ACTIONS,
  GH_PR_REVIEW_COMMENT_ACTIONS,
  GH_PR_REVIEW_THREAD_ACTIONS,
  GH_INSTALL_ACTIONS
};