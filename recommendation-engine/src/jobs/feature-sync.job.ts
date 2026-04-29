/**
 * feature-sync.job.ts — Kafka consumer that keeps ai.user_features and
 * ai.browsing_events up-to-date in real time by reacting to domain events.
 *
 * Consumed topics:
 *   - OrderCompleted  → update genre_vector, increment purchase counters
 *   - PageViewed      → insert browsing event, increment 30d browse counter in Redis
 *   - SearchPerformed → insert browsing event
 *
 * Uses the KafkaConsumerAdapter interface (same pattern as resale-api) so the
 * actual Kafka client is injected and never imported directly here.
 */

import {
  DbAdapter,
  KafkaConsumerAdapter,
  KafkaMessage,
  OrderCompletedPayload,
  PageViewedPayload,
  RedisAdapter,
  SearchPerformedPayload,
} from "../types/recommendation.types";

// ─── Configuration ────────────────────────────────────────────────────────────

const CONSUMER_GROUP = "ai-feature-sync";
const TOPICS = ["OrderCompleted", "PageViewed", "SearchPerformed"];

/** Redis key for the rolling 30-day browse counter per user */
const browseCounterKey = (userId: string) =>
  `features:browse_count_30d:${userId}`;

/** TTL for the browse counter: 31 days (slightly longer than the window) */
const BROWSE_COUNTER_TTL = 31 * 24 * 60 * 60;

// ─── Dependencies ─────────────────────────────────────────────────────────────

interface FeatureSyncDeps {
  kafka: KafkaConsumerAdapter;
  db: DbAdapter;
  redis: RedisAdapter;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * OrderCompleted:
 *   1. Upsert ai.user_features if not exists
 *   2. Increment total_purchases
 *   3. Update last_purchase_at
 *   4. Merge eventCategory weight (+1) into genre_vector using
 *      exponential smoothing: new = 0.8×old + 0.2×delta
 */
async function handleOrderCompleted(
  payload: OrderCompletedPayload,
  db: DbAdapter,
  redis: RedisAdapter,
): Promise<void> {
  const { userId, eventCategory, occurredAt } = payload;

  // Step 1 & 2 & 3: upsert base fields
  await db.execute(
    `INSERT INTO ai.user_features (user_id, total_purchases, last_purchase_at, updated_at)
     VALUES ($1, 1, $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       total_purchases  = ai.user_features.total_purchases + 1,
       last_purchase_at = EXCLUDED.last_purchase_at,
       updated_at       = NOW()`,
    [userId, occurredAt],
  );

  // Step 4: merge category into genre_vector
  // We do this in a separate query to read the current vector first
  interface Row {
    genre_vector: Record<string, number>;
  }

  const rows = await db.query<Row>(
    `SELECT genre_vector FROM ai.user_features WHERE user_id = $1`,
    [userId],
  );

  const currentVector: Record<string, number> = rows[0]?.genre_vector ?? {};
  const oldWeight = currentVector[eventCategory] ?? 0;
  // Exponential smoothing: blend old weight towards 1.0 with α = 0.2
  const newWeight = 0.8 * oldWeight + 0.2 * 1.0;
  currentVector[eventCategory] = newWeight;

  // Normalise the vector so weights sum to ≤ 1
  const total = Object.values(currentVector).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const key of Object.keys(currentVector)) {
      currentVector[key] = currentVector[key] / total;
    }
  }

  await db.execute(
    `UPDATE ai.user_features
     SET genre_vector = $2::jsonb, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, JSON.stringify(currentVector)],
  );

  // Invalidate cached user features so next read gets fresh data
  await redis.del(`features:user:${userId}`);
}

/**
 * PageViewed:
 *   1. Insert into ai.browsing_events
 *   2. Increment the rolling 30-day browse counter in Redis
 *   3. Periodically sync the Redis counter back to ai.user_features
 *      (every 10th increment to keep DB writes low)
 */
async function handlePageViewed(
  payload: PageViewedPayload,
  db: DbAdapter,
  redis: RedisAdapter,
): Promise<void> {
  const { userId, sessionId, eventId, occurredAt } = payload;

  // Only track authenticated users
  if (!userId) return;

  await db.execute(
    `INSERT INTO ai.browsing_events
       (user_id, session_id, event_type, event_id, search_query, occurred_at)
     VALUES ($1, $2, 'page_view', $3, NULL, $4)`,
    [userId, sessionId, eventId, occurredAt],
  );

  const counterKey = browseCounterKey(userId);
  const newCount = await redis.incr(counterKey);

  // Set TTL on first increment (INCR creates the key)
  if (newCount === 1) {
    await redis.expire(counterKey, BROWSE_COUNTER_TTL);
  }

  // Every 10 events, sync the counter back to PostgreSQL
  if (newCount % 10 === 0) {
    await db.execute(
      `UPDATE ai.user_features
       SET events_browsed_30d = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, newCount],
    ).catch(() => {
      // If user row doesn't exist yet, it will be created on first purchase
    });
  }
}

/**
 * SearchPerformed:
 *   1. Insert into ai.browsing_events with search_query
 */
async function handleSearchPerformed(
  payload: SearchPerformedPayload,
  db: DbAdapter,
): Promise<void> {
  const { userId, sessionId, query, occurredAt } = payload;

  if (!userId) return;

  await db.execute(
    `INSERT INTO ai.browsing_events
       (user_id, session_id, event_type, event_id, search_query, occurred_at)
     VALUES ($1, $2, 'search', NULL, $3, $4)`,
    [userId, sessionId, query, occurredAt],
  );
}

// ─── Message router ───────────────────────────────────────────────────────────

async function routeMessage(
  message: KafkaMessage,
  db: DbAdapter,
  redis: RedisAdapter,
): Promise<void> {
  switch (message.topic) {
    case "OrderCompleted": {
      const payload = message.value as OrderCompletedPayload;
      await handleOrderCompleted(payload, db, redis);
      break;
    }
    case "PageViewed": {
      const payload = message.value as PageViewedPayload;
      await handlePageViewed(payload, db, redis);
      break;
    }
    case "SearchPerformed": {
      const payload = message.value as SearchPerformedPayload;
      await handleSearchPerformed(payload, db);
      break;
    }
    default:
      // Unknown topic — log and skip
      console.warn(
        `[feature-sync] Unknown topic "${message.topic}" — skipping`,
      );
  }
}

// ─── Consumer lifecycle ───────────────────────────────────────────────────────

export async function startFeatureSyncConsumer(
  deps: FeatureSyncDeps,
): Promise<void> {
  const { kafka, db, redis } = deps;

  console.log(
    `[feature-sync] Starting Kafka consumer group="${CONSUMER_GROUP}" topics=${TOPICS.join(",")}`,
  );

  await kafka.subscribe(TOPICS);

  let shutdownRequested = false;

  const onShutdown = async () => {
    console.log("[feature-sync] Shutdown requested — disconnecting Kafka consumer");
    shutdownRequested = true;
    await kafka.disconnect();
  };

  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);

  await kafka.consume(async (message) => {
    if (shutdownRequested) return;

    try {
      await routeMessage(message, db, redis);
    } catch (err) {
      // Log the error but do not re-throw: the consumer will continue
      // processing subsequent messages. In production, the dead-letter
      // queue strategy would be handled by the KafkaConsumerAdapter implementation.
      console.error(
        `[feature-sync] Failed to process message topic=${message.topic} offset=${message.offset}:`,
        err instanceof Error ? err.message : err,
      );
    }
  });

  process.off("SIGINT", onShutdown);
  process.off("SIGTERM", onShutdown);

  console.log("[feature-sync] Consumer stopped");
}
