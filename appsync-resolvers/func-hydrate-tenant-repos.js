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
      'pk': 'REPO',
      'sk': `${x.provider}#${x.providerId}`
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
  const repos = ctx.result.data[ctx.env.REPOS_TABLE_NAME]
  const nextToken = ctx.prev.result.nextToken

  return {
    repos,
    nextToken
  }
}
