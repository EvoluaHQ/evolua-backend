import { util, runtime } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBQueryRequest}
*/
export function request(ctx) {
  const tenantId = ctx.identity.resolverContext.tenantId

  return {
    operation: 'GetItem',
    index: 'evoluaRepoIdIndex',
    query: {
      expression: 'tenantId = :tenantId AND evoluaRepoId = :evoluaRepoId',
      expressionValues: util.dynamodb.toMapValues({
        ':tenantId': tenantId,
        ':evoluaRepoId': ctx.arguments.evoluaRepoId
      }),
    },
    limit: 1,
    scanIndexForward: true,
    select: 'ALL_ATTRIBUTES',
    consistentRead: false
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
  const matches = ctx.result.items || []
  if (matches.length < 1) {
    runtime.earlyReturn({
      scans: [],
    })
  }

  return ctx.result
}
