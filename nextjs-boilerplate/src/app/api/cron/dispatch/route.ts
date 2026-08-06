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

// ── VYPNUTO (F6/F7) ─────────────────────────────────────────────────────────
// 'demand-forecast'      — pise proti jinemu designu tabulky (9 sloupcu nesedi)
// 'seat-upgrade-notify'  — chybi tabulky, mj. orders.seat_assignments
//                          (grep v baseline: 0 vyskytu)
// Vypnuti se dela ODEBRANIM z tohohle allowlistu — dispatcher pak vrati 422
// "Unknown job". Je to mechanismus, ktery uz v repu je; nezavadim novy.
// Odpovidajici zaznamy jsou zaroven odebrane z vercel.json (crons).
// Kontrakt C2 se jich netyka: vypnuta routa kontrakt nepotrebuje.
// TIKETY "dostavet" u obou ZUSTAVAJI OTEVRENE (REMEDIATION R-20, R-21).
const ALLOWED_JOBS = new Set([
  'abandoned-cart',
  'anomaly-detect',
  'bank-sync-fio',
  'charge-installments',
  'consent-log-purge',
  'daily-stats',
  'newsletter-digest',
  'verify-event-completion',
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
  // P4 — recently added internal crons:
  'recompute-dynamic-pricing', // P1.6 — every 5 min recompute prices
  'refresh-spotify',           // P4 — refresh Spotify tokens expiring soon
  'music-distribute',          // distribuce koncertů na Bandsintown/Songkick
  'send-commemorative',        // vzpomínkové vstupenky — den po představení
  // ForgeMsg integration
  'forgemsg-dispatch',         // drain outbox → ForgeMsg ticketing ingest
  'forgemsg-sync-events',      // sync upcoming events + unsold seats → ForgeMsg
  'forgemsg-provision',        // create ForgeMsg org + key for new promoters
  // Feature 4: Payout SLA
  'event-payout-release',      // auto-payout N days after event ends (per-promoter SLA)
  // Feature 8: Demand Forecasting
  // Seat upgrade notifications — unique differentiator vs Eventim/TM
  // AXS Invite — release expired adjacent-seat holds
  'release-group-invite-holds',
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
