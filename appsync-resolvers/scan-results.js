import { util } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBQueryRequest}
*/
export function request(ctx) {
  return {
    operation: 'Query',
    query: {
      expression: 'scanId = :scanId',
      expressionValues: util.dynamodb.toMapValues({
        ':scanId': ctx.source.scanId,
      }),
    },
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
  return ctx.result.items
}
