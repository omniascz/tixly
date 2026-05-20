/**
 * GET /api/cron/dispatch?job=<name>
 *
 * Vercel cron dispatcher: Vercel volá GET s `Authorization: Bearer ${CRON_SECRET}`,
 * dispatch endpoint interně POSTuje na příslušný `/api/internal/cron/<job>`
 * s INTERNAL_SERVICE_TOKEN — Vercel cron tak může spouštět všechny existující
 * `/api/internal/cron/*` endpointy bez nutnosti refaktorovat 11 souborů.
 *
 * Bezpečnost dvojí:
 *   1. Vercel cron přidá `Authorization: Bearer <CRON_SECRET>` (z env)
 *   2. Dispatcher přidá `x-internal-token` (INTERNAL_SERVICE_TOKEN) interně
 *
 * Registr v `vercel.json`:
 *   { "path": "/api/cron/dispatch?job=expire-pending-orders", "schedule": "*\/5 * * * *" }
 */

import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_JOBS = new Set([
  'abandoned-cart',
  'anomaly-detect',
  'bank-sync-fio',
  'charge-installments',
  'consent-log-purge',
  'daily-stats',
  'newsletter-digest',
  'expire-pending-orders',
  'onboarding-reminder',
  'payouts-auto-settle',
  'process-gdpr-deletions',
  'promoter-tier-evaluate',
  'release-expired-seat-holds',
  'release-rolling-reserves',
  'renew-subscriptions',
  'send-reminders',
  'waitlist-notify',
]);

export async function GET(req: NextRequest): Promise<Response> {
  // 1) Verify Vercel cron auth
  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const expected = `Bearer ${cronSecret}`;
    if (authHeader !== expected) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else if (!req.headers.get('x-vercel-cron')) {
    // Žádný CRON_SECRET v env + není to Vercel cron → odmítni
    // (dev test může volat ručně přes ?job=X bez Vercel headers; pak musí mít token)
    return NextResponse.json(
      { error: 'CRON_SECRET not configured and not a Vercel cron call' },
      { status: 403 },
    );
  }

  const job = req.nextUrl.searchParams.get('job');
  if (!job || !ALLOWED_JOBS.has(job)) {
    return NextResponse.json({ error: 'Unknown job', allowed: [...ALLOWED_JOBS] }, { status: 422 });
  }

  // 2) Internal call s service tokenem
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? '';

  try {
    const res = await fetch(`${baseUrl}/api/internal/cron/${job}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: '{}',
    });
    const data: unknown = await res.json().catch(() => ({}));
    return NextResponse.json({
      job,
      status: res.status,
      result: data,
    });
  } catch (e) {
    return NextResponse.json(
      { job, error: 'DISPATCH_FAILED', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
