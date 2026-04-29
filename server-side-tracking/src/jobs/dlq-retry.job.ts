/**
 * Dead Letter Queue retry job.
 *
 * Runs nightly at 03:00 (configured via cron or systemd timer).
 * Fetches failed tracking events (retry_after <= NOW(), attempts < 6),
 * retries them via Meta and TikTok APIs, and either:
 *   - On success: moves record to tracking.sent_events and deletes from failed_events
 *   - On failure: increments attempts, sets retry_after = NOW() + 1 day
 *
 * Records with attempts >= 6 are left in failed_events for manual review.
 *
 * Environment variables required:
 *   DATABASE_URL
 *   REDIS_URL
 *   META_PIXEL_ID
 *   META_ACCESS_TOKEN
 *   META_TEST_EVENT_CODE   (optional)
 *   TIKTOK_PIXEL_CODE
 *   TIKTOK_ACCESS_TOKEN
 */

import { createClient } from 'redis';
import pg from 'pg';
import {
  TrackingPlatform,
  TrackingApiError,
  type ServiceDeps,
  type Logger,
  type DbAdapter,
  type RedisAdapter,
  type HttpClient,
  type HttpResponse,
  type FailedEventRow,
} from '../types/tracking.types.js';
import { withRetry } from '../lib/retry.js';
import { addTestEventCode, getMetaApiUrl } from '../lib/meta-payload-builder.js';
import { TIKTOK_API_URL } from '../lib/tiktok-payload-builder.js';

const RETRY_CONFIG = { maxAttempts: 3, baseDelayMs: 1000 };

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
             retry_after = NOW() + ($1 || ' days')::INTERVAL
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

// ─── Platform-specific retry logic ───────────────────────────────────────────

async function retryEventForPlatform(
  row: FailedEventRow,
  deps: ServiceDeps,
): Promise<{ responseStatus: number; responseBody: string }> {
  const url =
    row.platform === TrackingPlatform.Meta
      ? getMetaApiUrl()
      : TIKTOK_API_URL;

  let payloadToSend: object = row.payload;

  if (row.platform === TrackingPlatform.Meta) {
    const testCode = process.env['META_TEST_EVENT_CODE'];
    payloadToSend = addTestEventCode(row.payload, testCode);
  }

  let attempts = 0;

  const response = await withRetry(async () => {
    attempts++;
    const res = await deps.httpClient.post(url, payloadToSend, {
      'Content-Type': 'application/json',
    });

    if (res.status >= 400) {
      throw new TrackingApiError(
        `${row.platform} API error ${res.status}`,
        res.status,
        row.platform,
        res.body,
      );
    }
    return res;
  }, RETRY_CONFIG);

  return { responseStatus: response.status, responseBody: response.body };
}

// ─── Main DLQ retry loop ──────────────────────────────────────────────────────

export async function runDlqRetry(deps: ServiceDeps): Promise<{ total: number; succeeded: number; failed: number }> {
  const rows = await deps.db.getFailedEventsForRetry();

  logger.info('DLQ retry job started', { eventsToRetry: rows.length });

  let successCount = 0;
  let failureCount = 0;

  for (const row of rows) {
    try {
      const { responseStatus, responseBody } = await retryEventForPlatform(row, deps);

      // Success — move to sent_events and remove from failed_events
      await deps.db.insertSentEvent({
        platform: row.platform,
        eventName: row.eventName,
        eventId: row.eventId,
        payload: row.payload,
        responseStatus,
        responseBody,
        attempts: row.attempts + 1,
      });

      await deps.db.deleteFailedEvent(row.id);

      // Update Redis dedup key so this event is not re-sent
      const dedupKey = `tracking:${row.platform}:${row.eventId}`;
      await deps.redis.setWithTtl(dedupKey, '1', 86_400);

      deps.logger.info('DLQ retry: event succeeded', {
        id: row.id,
        platform: row.platform,
        eventId: row.eventId,
        eventName: row.eventName,
      });

      successCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      deps.logger.error('DLQ retry: event still failing', {
        id: row.id,
        platform: row.platform,
        eventId: row.eventId,
        attempts: row.attempts + 1,
        error: errorMessage,
      });

      // Increment attempts; retry_after = +1 day
      await deps.db.incrementFailedEventAttempts(row.id, 1);

      failureCount++;
    }
  }

  logger.info('DLQ retry job completed', {
    total: rows.length,
    succeeded: successCount,
    failed: failureCount,
  });

  return { total: rows.length, succeeded: successCount, failed: failureCount };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'] ?? '';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const redisClient = createClient({ url: redisUrl });
  await redisClient.connect();

  const deps: ServiceDeps = {
    httpClient,
    db: createDbAdapter(pool),
    redis: createRedisAdapter(redisClient),
    logger,
  };

  try {
    await runDlqRetry(deps);
  } finally {
    await redisClient.disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error in DLQ retry job:', err);
  process.exit(1);
});
