/**
 * Kafka consumer job for server-side tracking.
 *
 * Consumer group: server-side-tracking
 * Topics consumed: order-completed, page-viewed, order-created
 *
 * Each consumed message is routed to the TrackingOrchestrator.
 * On unrecoverable error the raw message is written to tracking.failed_events (DLQ).
 * Graceful shutdown on SIGINT / SIGTERM.
 *
 * Environment variables required:
 *   KAFKA_BROKERS      — comma-separated broker list, e.g. localhost:9092
 *   KAFKA_CLIENT_ID    — client identifier
 *   KAFKA_GROUP_ID     — consumer group (default: server-side-tracking)
 *   REDIS_URL          — redis connection string
 *   DATABASE_URL       — PostgreSQL connection string
 *   META_PIXEL_ID
 *   META_ACCESS_TOKEN
 *   META_TEST_EVENT_CODE   (optional)
 *   TIKTOK_PIXEL_CODE
 *   TIKTOK_ACCESS_TOKEN
 */

import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import { createClient } from 'redis';
import pg from 'pg';
import {
  TrackingPlatform,
  type ServiceDeps,
  type Logger,
  type DbAdapter,
  type RedisAdapter,
  type HttpClient,
  type HttpResponse,
  type FailedEventRow,
  type OrderCompletedKafkaEvent,
  type PageViewedKafkaEvent,
  type OrderCreatedKafkaEvent,
} from '../types/tracking.types.js';
import * as orchestrator from '../services/tracking-orchestrator.service.js';

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger: Logger = {
  info: (message, meta) => console.log(JSON.stringify({ level: 'info', message, ...meta })),
  warn: (message, meta) => console.warn(JSON.stringify({ level: 'warn', message, ...meta })),
  error: (message, meta) => console.error(JSON.stringify({ level: 'error', message, ...meta })),
};

// ─── HTTP Client ──────────────────────────────────────────────────────────────

const httpClient: HttpClient = {
  async post(url, payload, headers = {}): Promise<HttpResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    return { status: response.status, body };
  },
};

// ─── DB Adapter ───────────────────────────────────────────────────────────────

function createDbAdapter(pool: pg.Pool): DbAdapter {
  return {
    async insertSentEvent(params) {
      await pool.query(
        `INSERT INTO tracking.sent_events
           (platform, event_name, event_id, payload, response_status, response_body, attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (platform, event_id) DO NOTHING`,
        [
          params.platform,
          params.eventName,
          params.eventId,
          JSON.stringify(params.payload),
          params.responseStatus,
          params.responseBody,
          params.attempts,
        ],
      );
    },

    async insertFailedEvent(params) {
      await pool.query(
        `INSERT INTO tracking.failed_events
           (platform, event_name, event_id, payload, last_error, attempts)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          params.platform,
          params.eventName,
          params.eventId,
          JSON.stringify(params.payload),
          params.lastError,
          params.attempts,
        ],
      );
    },

    async getFailedEventsForRetry(): Promise<FailedEventRow[]> {
      const result = await pool.query(
        `SELECT id, platform, event_name, event_id, payload, last_error, attempts
         FROM tracking.failed_events
         WHERE retry_after <= NOW() AND attempts < 6
         ORDER BY retry_after ASC
         LIMIT 500`,
      );
      return result.rows.map((row) => ({
        id: row.id as string,
        platform: row.platform as TrackingPlatform,
        eventName: row.event_name as string,
        eventId: row.event_id as string,
        payload: row.payload as object,
        lastError: row.last_error as string,
        attempts: row.attempts as number,
      }));
    },

    async deleteFailedEvent(id: string) {
      await pool.query('DELETE FROM tracking.failed_events WHERE id = $1', [id]);
    },

    async incrementFailedEventAttempts(id: string, retryAfterDays: number) {
      await pool.query(
        `UPDATE tracking.failed_events
         SET attempts = attempts + 1,
             retry_after = NOW() + ($1 || ' days')::INTERVAL,
             last_error = last_error
         WHERE id = $2`,
        [retryAfterDays, id],
      );
    },
  };
}

// ─── Redis Adapter ────────────────────────────────────────────────────────────

function createRedisAdapter(client: ReturnType<typeof createClient>): RedisAdapter {
  return {
    async exists(key: string): Promise<boolean> {
      const result = await client.exists(key);
      return result > 0;
    },
    async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
      await client.set(key, value, { EX: ttlSeconds });
    },
  };
}

// ─── Message routing ──────────────────────────────────────────────────────────

const TOPICS = {
  ORDER_COMPLETED: 'order-completed',
  PAGE_VIEWED: 'page-viewed',
  ORDER_CREATED: 'order-created',
} as const;

async function routeMessage(
  topic: string,
  value: string,
  deps: ServiceDeps,
): Promise<void> {
  const parsed: unknown = JSON.parse(value);

  switch (topic) {
    case TOPICS.ORDER_COMPLETED:
      await orchestrator.handleOrderCompleted(parsed as OrderCompletedKafkaEvent, deps);
      break;
    case TOPICS.PAGE_VIEWED:
      await orchestrator.handlePageViewed(parsed as PageViewedKafkaEvent, deps);
      break;
    case TOPICS.ORDER_CREATED:
      await orchestrator.handleOrderCreated(parsed as OrderCreatedKafkaEvent, deps);
      break;
    default:
      deps.logger.warn('Kafka: unknown topic received', { topic });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');
  const clientId = process.env['KAFKA_CLIENT_ID'] ?? 'server-side-tracking';
  const groupId = process.env['KAFKA_GROUP_ID'] ?? 'server-side-tracking';
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  const kafka = new Kafka({ clientId, brokers });
  const consumer: Consumer = kafka.consumer({ groupId });

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const redisClient = createClient({ url: redisUrl });
  await redisClient.connect();

  const deps: ServiceDeps = {
    httpClient,
    db: createDbAdapter(pool),
    redis: createRedisAdapter(redisClient),
    logger,
  };

  await consumer.connect();
  await consumer.subscribe({
    topics: [TOPICS.ORDER_COMPLETED, TOPICS.PAGE_VIEWED, TOPICS.ORDER_CREATED],
    fromBeginning: false,
  });

  logger.info('Kafka consumer started', { groupId, brokers });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      const value = message.value?.toString();
      if (!value) {
        logger.warn('Kafka: empty message received', { topic, partition });
        return;
      }

      try {
        await routeMessage(topic, value, deps);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('Kafka: failed to process message, writing to DLQ', {
          topic,
          partition,
          offset: message.offset,
          error: errorMessage,
        });

        // Write to DLQ — best-effort, do not re-throw
        try {
          await deps.db.insertFailedEvent({
            platform: TrackingPlatform.Meta, // unknown platform for DLQ from consumer
            eventName: topic,
            eventId: `${topic}-${message.offset}-${Date.now()}`,
            payload: { rawValue: value },
            lastError: errorMessage,
            attempts: 3,
          });
        } catch (dlqError) {
          const dlqMsg = dlqError instanceof Error ? dlqError.message : String(dlqError);
          logger.error('Kafka: DLQ write failed', { error: dlqMsg });
        }
      }
    },
  });

  // ─── Graceful shutdown ───────────────────────────────────────────────────

  async function shutdown(signal: string): Promise<void> {
    logger.info(`Received ${signal}, shutting down gracefully`);
    await consumer.disconnect();
    await redisClient.disconnect();
    await pool.end();
    logger.info('Consumer shut down cleanly');
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error in tracking consumer:', err);
  process.exit(1);
});
