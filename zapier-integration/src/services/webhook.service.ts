import crypto from 'crypto';
import type {
  WebhookSubscription,
  WebhookDelivery,
  SubscriptionInput,
  ServiceDeps,
  DeliveryStatus,
} from '../types/zapier.types.js';
import { ZapierError } from '../types/zapier.types.js';

function generateId(): string {
  return crypto.randomUUID();
}

function computeSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export async function subscribeWebhook(
  input: SubscriptionInput,
  deps: ServiceDeps,
): Promise<WebhookSubscription> {
  const id = generateId();
  const now = new Date();

  await deps.db.execute(
    `INSERT INTO webhook_subscriptions (id, organizer_id, target_url, trigger_event, secret, is_active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.organizerId, input.targetUrl, input.triggerEvent, input.secret, true, now],
  );

  return {
    id,
    organizerId: input.organizerId,
    targetUrl: input.targetUrl,
    triggerEvent: input.triggerEvent,
    secret: input.secret,
    isActive: true,
    createdAt: now,
  };
}

export async function unsubscribeWebhook(
  subscriptionId: string,
  organizerId: string,
  deps: ServiceDeps,
): Promise<void> {
  const rows = await deps.db.query<WebhookSubscription>(
    `SELECT * FROM webhook_subscriptions WHERE id = $1 AND organizer_id = $2`,
    [subscriptionId, organizerId],
  );

  if (rows.length === 0) {
    throw new ZapierError('SUBSCRIPTION_NOT_FOUND', `Subscription ${subscriptionId} not found for organizer ${organizerId}`);
  }

  await deps.db.execute(
    `UPDATE webhook_subscriptions SET is_active = false WHERE id = $1`,
    [subscriptionId],
  );
}

export async function deliverEvent(
  subscriptionId: string,
  payload: Record<string, unknown>,
  deps: ServiceDeps,
): Promise<WebhookDelivery> {
  const subscriptions = await deps.db.query<WebhookSubscription>(
    `SELECT * FROM webhook_subscriptions WHERE id = $1 AND is_active = true`,
    [subscriptionId],
  );

  if (subscriptions.length === 0) {
    throw new ZapierError('SUBSCRIPTION_NOT_FOUND', `Subscription ${subscriptionId} not found or inactive`);
  }

  const subscription = subscriptions[0] as WebhookSubscription;
  const deliveryId = generateId();
  const now = new Date();
  const bodyJson = JSON.stringify(payload);
  const signature = computeSignature(bodyJson, subscription.secret);

  const response = await deps.http.post(subscription.targetUrl, payload, {
    'Content-Type': 'application/json',
    'X-Tixly-Signature': signature,
  });

  const status: DeliveryStatus = response.ok ? 'delivered' : 'retrying';

  await deps.db.execute(
    `INSERT INTO webhook_deliveries
       (id, subscription_id, payload, status, attempts, last_attempt_at, next_retry_at, response_code, error_message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      deliveryId,
      subscriptionId,
      JSON.stringify(payload),
      status,
      1,
      now,
      status === 'retrying' ? new Date(now.getTime() + 2 * 60 * 1000) : null,
      response.status,
      response.ok ? null : `HTTP ${response.status}`,
      now,
    ],
  );

  return {
    id: deliveryId,
    subscriptionId,
    payload,
    status,
    attempts: 1,
    lastAttemptAt: now,
    nextRetryAt: status === 'retrying' ? new Date(now.getTime() + 2 * 60 * 1000) : null,
    responseCode: response.status,
    errorMessage: response.ok ? null : `HTTP ${response.status}`,
    createdAt: now,
  };
}

export async function retryFailedDeliveries(deps: ServiceDeps): Promise<void> {
  const now = new Date();

  const deliveries = await deps.db.query<WebhookDelivery & { target_url: string; secret: string }>(
    `SELECT d.*, s.target_url, s.secret
     FROM webhook_deliveries d
     JOIN webhook_subscriptions s ON s.id = d.subscription_id
     WHERE d.status = 'retrying'
       AND d.next_retry_at <= $1`,
    [now],
  );

  for (const delivery of deliveries) {
    const MAX_ATTEMPTS = 5;

    if (delivery.attempts >= MAX_ATTEMPTS) {
      await deps.db.execute(
        `UPDATE webhook_deliveries SET status = $1, last_attempt_at = $2 WHERE id = $3`,
        ['failed', now, delivery.id],
      );
      continue;
    }

    const bodyJson = JSON.stringify(delivery.payload);
    const signature = computeSignature(bodyJson, delivery.secret);

    const response = await deps.http.post(delivery.target_url, delivery.payload, {
      'Content-Type': 'application/json',
      'X-Tixly-Signature': signature,
    });

    const newAttempts = delivery.attempts + 1;
    const succeeded = response.ok;
    const newStatus: DeliveryStatus = succeeded
      ? 'delivered'
      : newAttempts >= MAX_ATTEMPTS
        ? 'failed'
        : 'retrying';

    // Exponential backoff: 2^attempts minutes
    const nextRetryMinutes = Math.pow(2, newAttempts);
    const nextRetryAt = newStatus === 'retrying'
      ? new Date(now.getTime() + nextRetryMinutes * 60 * 1000)
      : null;

    await deps.db.execute(
      `UPDATE webhook_deliveries
       SET status = $1, attempts = $2, last_attempt_at = $3, next_retry_at = $4, response_code = $5, error_message = $6
       WHERE id = $7`,
      [
        newStatus,
        newAttempts,
        now,
        nextRetryAt,
        response.status,
        succeeded ? null : `HTTP ${response.status}`,
        delivery.id,
      ],
    );
  }
}
