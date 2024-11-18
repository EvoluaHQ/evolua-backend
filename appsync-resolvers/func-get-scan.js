import { util, runtime } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBGetItemRequest}
*/
export function request(ctx) {
  if (!ctx.prev.result.items || ctx.prev.result.items.length === 0) {
    runtime.earlyReturn(null)

    return
  }

  const repo = ctx.prev.result.items[0]
  const repoId = `${repo.provider}#${repo.providerRepoId}`

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ 
      repoId,
      scanId: ctx.arguments.scanId
    })
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
  return ctx.result
}
