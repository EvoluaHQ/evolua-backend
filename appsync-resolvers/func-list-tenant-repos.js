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
    limit: 25,
    nextToken: ctx.arguments.nextToken,
    query: {
      expression: '#pk = :pk AND begins_with(#sk, :sk)',
      expressionNames: {
        '#pk': 'pk',
        '#sk': 'sk',
      },
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `TENANT#${tenantId}`,
        ':sk': 'REPO#',
      }),
    },
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
 return ctx.result
}
