import { util } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBBatchGetItemRequest}
*/
export function request(ctx) {
  if (ctx.args.providerRepoIds.length > 25) {
    return util.appendError('providerRepoIds array max length is 25', 'ValidationException')
  }

  const tenantId = ctx.identity.resolverContext.tenantId
  const tableName = ctx.env.TENANT_REPOS_TABLE_NAME
  const provider = ctx.args.provider
  const repoIds = ctx.args.providerRepoIds.map(x => `${provider}#${x}`)
  const keys = repoIds.map(x => util.dynamodb.toMapValues({
    'tenantId': tenantId,
    'repoId': x
  }))

  return {
    operation: 'BatchGetItem',
    tables: {
      [tableName]: {
        keys
      }
    } 
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
  // with batch get item, if a key is not found, it will return null
  const repos = ctx.result.data[ctx.env.TENANT_REPOS_TABLE_NAME].filter(x => x)
  repos.forEach(x => x.enabled = true)

  return repos
}
