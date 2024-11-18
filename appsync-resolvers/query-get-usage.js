import { util } from '@aws-appsync/utils'

const SUBSCRIPTION_TIERS = {
  'FREE': {
    maxScans: 5,
    filesPerScan: 10,
    maxFileSize: 500_000, // 500 KB
  },
  'PRO': {
    maxScans: 100,
    filesPerScan: 100,
    maxFileSize: 1_000_000, // 1MB
  }
}

/**
 * @param { import('@aws-appsync/utils').Context 
*   & {identity: import('@aws-appsync/utils').AppSyncIdentityLambda} } ctx 
* @returns {import('@aws-appsync/utils').DynamoDBGetItemRequest}
*/
export function request(ctx) {
  const tenantId = ctx.identity.resolverContext.tenantId

  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({ id: tenantId })
  }
}

/**
* @param {import('@aws-appsync/utils').Context} ctx 
*/
export function response(ctx) {
  if (!ctx.result) {
    return null
  }

  const tier = ctx.result.tier || 'FREE'
  const subscriptionTier = SUBSCRIPTION_TIERS[tier]
  
  return {
    tier,
    scans: ctx.result.scanCount,
    limit: {
      tier,
      scans: subscriptionTier.maxScans,
      filesPerScan: subscriptionTier.filesPerScan,
      maxFileSize: subscriptionTier.maxFileSize
    }
  }
}
