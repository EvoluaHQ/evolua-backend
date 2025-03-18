/**
 * GraphQL resolver for creating a knowledge base
 *
 * @param {object} ctx - The AppSync context
 * @returns {Promise<object>} - The response containing the created knowledge base
 */
export function request(ctx) {
  const { name, description } = ctx.arguments.input;

  // Prepare the Lambda request payload
  const payload = {
    name,
    description,
  };

  return {
    operation: "Invoke",
    payload: payload,
  };
}

/**
 * Response handler for create knowledge base
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
