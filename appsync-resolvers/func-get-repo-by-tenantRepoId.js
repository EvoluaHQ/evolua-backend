import { util } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBQueryRequest}
*/
export function request(ctx) {
  const tenantId = ctx.identity.resolverContext.tenantId

  return {
    operation: 'Query',
    index: 'tenantRepoIdIndex',
    query: {
      expression: 'tenantId = :tenantId AND tenantRepoId = :tenantRepoId',
      expressionValues: util.dynamodb.toMapValues({
        ':tenantId': tenantId,
        ':tenantRepoId': ctx.arguments.tenantRepoId
      }),
    },
    limit: 1,
    select: 'ALL_ATTRIBUTES',
    consistentRead: false
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {  
  return ctx.result
}
