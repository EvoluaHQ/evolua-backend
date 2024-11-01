import { util } from '@aws-appsync/utils'

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBQueryRequest}
*/
export function request(ctx) {
  return {
    operation: 'Query',
    limit: 25,
    nextToken: ctx.arguments.nextToken,
    query: {
      expression: '#repoId = :repoId',
      expressionNames: {
        '#repoId': 'repoId'
      },
      expressionValues: util.dynamodb.toMapValues({
        ':repoId': `${ctx.source.provider}#${ctx.source.providerId}`,
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
