/**
 * GraphQL resolver for listing knowledge bases for a tenant
 *
 * @param {object} ctx - The AppSync context
 * @returns {Promise<object>} - The response containing knowledge bases list
 */
export function request(ctx) {
  const { tenantId } = ctx.identity.claims;
  const { limit = 20, nextToken } = ctx.arguments;

  // Prepare the Lambda request payload
  const payload = {
    tenantId,
    limit,
    nextToken,
  };

  return {
    operation: "Invoke",
    payload: payload,
  };
}

/**
 * Response handler for list knowledge bases
 *
 * @param {object} ctx - The AppSync context
 * @returns {object} - The formatted response
 */
export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type, ctx.result);
  }

  // Return the Lambda response directly
  return ctx.result;
}
