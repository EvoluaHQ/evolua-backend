import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ulid } from 'ulid';
import middy from '@middy/core';
import ssm from '@middy/ssm';
import * as Events from './lib/events';
import Stripe from "stripe";

const { SSM_STAGE_NAME } = process.env;

const _handler = async (event: APIGatewayEvent, context: any): Promise<APIGatewayProxyResult> => {
  console.log(JSON.stringify(event));

  const signature = event.headers["Stripe-Signature"];
  if (!signature) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing signature" }),
    };
  }

  const stripe = new Stripe(context.STRIPE_SECRET_KEY, {
    apiVersion: "2024-11-20.acacia",
    typescript: true,
    maxNetworkRetries: 3, // Automatically retry failed requests
  });

  const stripeEvent = stripe.webhooks.constructEvent(
    event.body!,
    signature,
    context.STRIPE_WEBHOOK_SECRET
  );

  const eventType = stripeEvent.type;
  const payload = stripeEvent.data.object;

  const eventId = ulid();

  await Events.publishEvent(eventId, 'stripe', eventType, payload);
  await Events.saveEvent(eventId, 'stripe', eventType, payload);

  return {
    statusCode: 200,
    body: ""
  };
};

export const handler = middy(_handler)
  .use(ssm({
    cache: true,
    cacheExpiry: 5 * 60 * 1000, // 5 mins
    setToContext: true,
    fetchData: {
      STRIPE_SECRET_KEY: `/evolua/${SSM_STAGE_NAME}/stripe/secret-key`,
      STRIPE_WEBHOOK_SECRET: `/evolua/${SSM_STAGE_NAME}/stripe/webhook-secret`
    }
  }));
