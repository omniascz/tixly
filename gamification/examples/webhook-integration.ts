// Example: How to integrate gamification with order.completed webhook
// This shows where and how to call the badge checking logic

import type { WebhookEvent } from '../types'; // Your webhook event type
import { handleOrderCompleted } from '../src/webhook/order-completed';

/**
 * Example webhook dispatcher or handler that integrates with order.completed event.
 *
 * This would be in your main webhooks system (e.g., webhooks/src/services/dispatcher.service.ts)
 */
export async function dispatchWebhook(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'order.completed': {
      // Extract order and user info
      const orderId = event.payload.orderId;
      const userId = event.payload.userId;

      // Trigger gamification badge checking
      // This is async but non-blocking - don't await it in the webhook handler
      // to avoid slowing down the order completion response
      handleOrderCompleted(orderId, userId).catch((error) => {
        console.error('Failed to check badges after order completion:', error);
        // Don't re-throw - we don't want webhook failure if gamification fails
      });

      // Continue with other order.completed handlers
      break;
    }

    case 'booking.created': {
      // Other webhook handlers...
      break;
    }

    // ... other event types
  }
}

/**
 * Alternative: If you want to be more explicit about badge checking,
 * you could create a separate gamification webhook handler
 */
export async function handleGamificationWebhook(event: WebhookEvent): Promise<void> {
  if (event.type === 'order.completed') {
    const { orderId, userId } = event.payload;
    await handleOrderCompleted(orderId, userId);
  }
}

/**
 * Example: How to set up the webhook registration in your webhooks module
 * This would be in webhooks/src/services/dispatcher.service.ts
 */
export const WEBHOOK_HANDLERS = {
  'order.completed': async (payload: any) => {
    const { orderId, userId } = payload;

    // 1. Handle order completion in main orders module
    // ... your order handling logic

    // 2. Trigger gamification after successful order processing
    await handleOrderCompleted(orderId, userId).catch((err) => {
      console.error('Gamification check failed:', err);
    });

    // 3. Continue with other integrations (loyalty, email, etc.)
    // ... other integrations
  },
};

/**
 * Example: If using Kafka for events, subscribe to order.completed topic
 */
export async function setupKafkaGamificationSubscriber(kafka: any): Promise<void> {
  const consumer = kafka.consumer({ groupId: 'gamification-service' });

  await consumer.subscribe({ topic: 'order.completed' });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        const { orderId, userId } = event;

        // Check and award badges
        await handleOrderCompleted(orderId, userId);
      } catch (error) {
        console.error('Error processing order.completed event:', error);
        // Continue processing other messages
      }
    },
  });
}
