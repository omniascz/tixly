/**
 * POST /api/send-times/batch
 *
 * Returns optimal send-time recommendations for a list of user IDs.
 *
 * Auth:        Internal bearer token (INTERNAL_API_KEY env var)
 * Batch limit: 1000 user IDs per request
 * Rate limit:  5 requests / minute per IP (sliding window, Redis)
 *
 * Response format:
 *   ≤ 100 users → standard JSON
 *   > 100 users → NDJSON stream (one JSON object per line)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBatchSendTimes } from '../../../../services/send-time.service';
import type {
  BatchSendTimeResponse,
  DbAdapter,
  RedisAdapter,
} from '../../../../types/send-time.types';
import { BatchTooLargeError } from '../../../../types/send-time.types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const INTERNAL_API_KEY  = process.env.INTERNAL_API_KEY ?? '';
const BATCH_LIMIT       = 1000;
const STREAM_THRESHOLD  = 100;
const RATE_LIMIT_MAX    = 5;
const RATE_LIMIT_WINDOW = 60;   // seconds

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const batchRequestSchema = z.object({
  userIds: z
    .array(z.string().uuid())
    .min(1, 'At least one userId is required')
    .max(BATCH_LIMIT, `Maximum ${BATCH_LIMIT} userIds per request`),
});

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

async function getAdapters(): Promise<{ db: DbAdapter; redis: RedisAdapter }> {
  const [{ createDbAdapter }, { createRedisAdapter }] = await Promise.all([
    import('../../../../../../shared/db') as Promise<{ createDbAdapter: () => DbAdapter }>,
    import('../../../../../../shared/redis') as Promise<{ createRedisAdapter: () => RedisAdapter }>,
  ]);
  return { db: createDbAdapter(), redis: createRedisAdapter() };
}

// ---------------------------------------------------------------------------
// Rate limiter (sliding window counter in Redis)
// ---------------------------------------------------------------------------

async function checkRateLimit(
  clientId: string,
  redis: RedisAdapter
): Promise<boolean> {
  const key     = `rate-limit:send-times-batch:${clientId}`;
  const current = await redis.get(key);
  const count   = current ? parseInt(current, 10) : 0;

  if (count >= RATE_LIMIT_MAX) {
    return false;   // limit exceeded
  }

  // Increment; if first request set TTL for the window
  const newCount = count + 1;
  await redis.set(key, String(newCount), RATE_LIMIT_WINDOW);
  return true;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse | Response> {
  // ------------------------------------------------------------------
  // 1. Authentication
  // ------------------------------------------------------------------
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7) !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ------------------------------------------------------------------
  // 2. Adapters (needed for rate-limit check)
  // ------------------------------------------------------------------
  let db:    DbAdapter;
  let redis: RedisAdapter;

  try {
    ({ db, redis } = await getAdapters());
  } catch (err) {
    console.error('[send-times/batch] Adapter init failed:', err);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  // ------------------------------------------------------------------
  // 3. Rate limiting
  // ------------------------------------------------------------------
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const allowed  = await checkRateLimit(clientIp, redis);

  if (!allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Max 5 requests per minute.' },
      { status: 429 }
    );
  }

  // ------------------------------------------------------------------
  // 4. Parse & validate body
  // ------------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = batchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { userIds } = parsed.data;

  if (userIds.length > BATCH_LIMIT) {
    const err = new BatchTooLargeError(userIds.length, BATCH_LIMIT);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // ------------------------------------------------------------------
  // 5. Fetch recommendations
  // ------------------------------------------------------------------
  let sendTimes: Awaited<ReturnType<typeof getBatchSendTimes>>;

  try {
    sendTimes = await getBatchSendTimes(userIds, db, redis);
  } catch (err) {
    console.error('[send-times/batch] getBatchSendTimes failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const processedAt = new Date().toISOString();

  // ------------------------------------------------------------------
  // 6. Stream NDJSON for large batches, plain JSON for small ones
  // ------------------------------------------------------------------
  if (userIds.length > STREAM_THRESHOLD) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        for (const rec of sendTimes) {
          controller.enqueue(encoder.encode(JSON.stringify(rec) + '\n'));
        }
        // Emit a final metadata line
        controller.enqueue(
          encoder.encode(JSON.stringify({ processedAt, total: sendTimes.length }) + '\n')
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Processed-At': processedAt,
      },
    });
  }

  // Standard JSON response
  const response: BatchSendTimeResponse = { sendTimes, processedAt };
  return NextResponse.json(response, { status: 200 });
}
