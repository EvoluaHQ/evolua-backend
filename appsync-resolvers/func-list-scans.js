import { util } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBQueryRequest}
*/
export function request(ctx) {
  const repo = ctx.prev.result.items[0]
  const repoId = `${repo.provider}#${repo.providerRepoId}`

  return {
    operation: 'Query',
    scanIndexForward: false,
    limit: 10,
    nextToken: ctx.arguments.nextToken,
    query: {
      expression: 'repoId = :repoId',
      expressionValues: util.dynamodb.toMapValues({
        ':repoId': repoId
      }),
    },
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
  const scans = ctx.result.items
  const nextToken = ctx.result.nextToken

  return {
    scans,
    nextToken
  }
}
