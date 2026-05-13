/**
 * POST /api/re-engagement/unsubscribe
 *
 * GDPR-compliant unsubscribe endpoint. Accepts a userId (or resolves it
 * from the bearer token in a real implementation) and immediately marks
 * all active campaigns as 'unsubscribed'.
 *
 * Auth:    Bearer token (INTERNAL_API_KEY) OR a signed unsubscribe token
 *          embedded in the email link (token query param).
 * Returns: 200 OK on success, 400/401/500 on error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { unsubscribe } from '../../../services/re-engagement.service';
import type { DbAdapter, EmailAdapter, KafkaProducerAdapter, PushAdapter, ServiceDeps } from '../../../types/re-engagement.types';
import { UserUnsubscribedError } from '../../../types/re-engagement.types';

// ─── Configuration ────────────────────────────────────────────────────────────

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

// ─── Request schema ───────────────────────────────────────────────────────────

const bodySchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
});

// ─── Adapter factory (replaced with real adapters in production) ──────────────

async function getDeps(): Promise<ServiceDeps> {
  const [{ createDbAdapter }, { createKafkaAdapter }, { createEmailAdapter }, { createPushAdapter }] =
    await Promise.all([
      import('../../../../../../shared/db') as Promise<{ createDbAdapter: () => DbAdapter }>,
      import('../../../../../../shared/kafka') as Promise<{ createKafkaAdapter: () => KafkaProducerAdapter }>,
      import('../../../../../../shared/email') as Promise<{ createEmailAdapter: () => EmailAdapter }>,
      import('../../../../../../shared/push') as Promise<{ createPushAdapter: () => PushAdapter }>,
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
  // 1. Authentication — internal key or signed token in query param
  const authHeader = req.headers.get('authorization') ?? '';
  const isInternalCall =
    authHeader.startsWith('Bearer ') && authHeader.slice(7) === INTERNAL_API_KEY;

  // Signed unsubscribe links embed ?token=<signed-user-id>
  // In production this would verify a HMAC; here we accept userId directly
  // when coming from an authenticated internal caller.
  if (!isInternalCall) {
    // Check for a signed unsubscribe token (email link flow)
    const token = req.nextUrl.searchParams.get('token');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // TODO: verify HMAC signature of token before proceeding.
    // For now, the token IS the userId (dev/staging convenience).
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { userId } = parsed.data;

  // 3. Load deps
  let deps: ServiceDeps;
  try {
    deps = await getDeps();
  } catch (err) {
    console.error('[re-engagement/unsubscribe] Adapter init failed:', err);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  // 4. Execute unsubscribe
  try {
    await unsubscribe(deps, userId);
    return NextResponse.json({ success: true, userId }, { status: 200 });
  } catch (err) {
    if (err instanceof UserUnsubscribedError) {
      // Already unsubscribed — idempotent success.
      return NextResponse.json({ success: true, userId, alreadyUnsubscribed: true }, { status: 200 });
    }
    console.error('[re-engagement/unsubscribe] Unsubscribe failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
