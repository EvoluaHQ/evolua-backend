import { util } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBBatchGetItemRequest}
*/
export function request(ctx) {
  const tableName = ctx.env.REPOS_TABLE_NAME
  const keys = ctx.prev.result.items.map(x => 
    util.dynamodb.toMapValues({
      'repoId': `${x.provider}#${x.providerId}`
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
  const tenantRepos = ctx.prev.result.items
  // with batch get item, if a key is not found, it will return null
  const repos = ctx.result.data[ctx.env.REPOS_TABLE_NAME].filter(x => x)

  for (const tenantRepo of tenantRepos) {
    const repo = repos.find(x => x.repoId === `${tenantRepo.provider}#${tenantRepo.providerId}`)
    if (repo) {
      tenantRepo.enabled = true
    } else {
      tenantRepo.enabled = false
    }
  }

  const nextToken = ctx.prev.result.nextToken

  return {
    repos: tenantRepos,
    nextToken
  }
}
