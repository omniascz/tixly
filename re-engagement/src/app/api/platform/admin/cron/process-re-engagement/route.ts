/**
 * POST /api/platform/admin/cron/process-re-engagement
 *
 * Centralized cron endpoint for processing re-engagement campaigns.
 * Invokes the re-engagement service batch processor.
 *
 * Auth:    CRON_SECRET bearer token (set in environment).
 * Returns: 200 with { processed, failed } counters on success.
 *
 * This endpoint mirrors /api/cron/re-engagement but follows the
 * monorepo platform/admin/cron convention for easier orchestration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runCampaignBatch } from '../../../../../services/re-engagement.service.js';
import type {
  DbAdapter,
  EmailAdapter,
  KafkaProducerAdapter,
  PushAdapter,
  ServiceDeps,
} from '../../../../../types/re-engagement.types.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const CRON_SECRET = process.env.CRON_SECRET ?? '';

// ─── Adapter factory ──────────────────────────────────────────────────────────

async function getDeps(): Promise<ServiceDeps> {
  const [
    { createDbAdapter },
    { createKafkaAdapter },
    { createEmailAdapter },
    { createPushAdapter },
  ] = await Promise.all([
    import('../../../../../../shared/db.js') as Promise<{ createDbAdapter: () => DbAdapter }>,
    import('../../../../../../shared/kafka.js') as Promise<{ createKafkaAdapter: () => KafkaProducerAdapter }>,
    import('../../../../../../shared/email.js') as Promise<{ createEmailAdapter: () => EmailAdapter }>,
    import('../../../../../../shared/push.js') as Promise<{ createPushAdapter: () => PushAdapter }>,
  ]);

  return {
    db: createDbAdapter(),
    kafka: createKafkaAdapter(),
    email: createEmailAdapter(),
    push: createPushAdapter(),
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate with CRON_SECRET
  const authHeader = req.headers.get('authorization') ?? '';
  if (!CRON_SECRET || !authHeader.startsWith('Bearer ') || authHeader.slice(7) !== CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Load adapters
  let deps: ServiceDeps;
  try {
    deps = await getDeps();
  } catch (err) {
    console.error('[cron/process-re-engagement] Adapter init failed:', err);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  // 3. Run batch
  const startedAt = new Date();
  console.info('[cron/process-re-engagement] Batch started at', startedAt.toISOString());

  let result: { processed: number; failed: number };
  try {
    result = await runCampaignBatch(deps, startedAt);
  } catch (err) {
    console.error('[cron/process-re-engagement] runCampaignBatch threw unexpectedly:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  console.info(
    `[cron/process-re-engagement] Batch done — processed=${result.processed} failed=${result.failed}`,
  );

  return NextResponse.json(
    {
      success: true,
      module: 're-engagement',
      processed: result.processed,
      failed: result.failed,
      ranAt: startedAt.toISOString(),
    },
    { status: 200 },
  );
}
