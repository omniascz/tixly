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
import { isCronAuthorized } from '@/lib/security/cron-auth';

// ── VYPNUTO (F6/F7) ─────────────────────────────────────────────────────────
// 'seat-upgrade-notify'  — ZUSTAVA VYPNUTY. Premisa "chybi seat_assignments"
//                          sice NEPLATILA (sedadlo je na order_items.seat_id,
//                          FINDINGS 167), ale pod ni je RETEZ dalsich neshod:
//                          o.buyer_email, e.name, s.zone_name, s.row_label,
//                          s.label. Routa je psana proti JINEMU SCHEMATU;
//                          neni to zamena, je to prepis. R-42.
// 'demand-forecast'      — ZUSTAVA VYPNUTY, ale duvod se UPRESNIL (§170):
//                          neni to "9 sloupcu nesedi" (to znelo jako prejmenovani).
//                          analytics.demand_forecasts je per-ticket-type CENOVE
//                          doporuceni, kod pocita per-event prognozu poptavky
//                          v absolutnich poctech. 5 z 11 hodnot nema kam ulozit.
//                          Bud dostavet prognozu, nebo prepsat kod. R-47.
// 'seat-upgrade-notify'  — VRACENO 2026-08-08 (R-42): premisa neplatila,
//                          orders.seat_assignments byla odbocka; sedadlo je na
//                          orders.order_items.seat_id. Viz FINDINGS §167.
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
  // Kolo 7: opce na termíny sálu s prošlou lhůtou → expired, další v pořadí se posune (hodinově)
  'expire-date-holds',
  // Kolo 8: rezervace s platbou na pokladně — připomínka 24 h předem, propadlé uvolní místa (každých 15 min)
  'seat-reservations',
  // Kolo 8: firemní objednávky po splatnosti → upozornění pořadateli (denně)
  'corporate-orders-overdue',
]);

export async function GET(req: NextRequest): Promise<Response> {
  // 1) Verify Vercel cron auth
  // Kolo 2: bez CRON_SECRET fail-closed (x-vercel-cron pošle kdokoli). Kolo 3: sdílený
  // helper lib/security/cron-auth.ts (porovnání v konstantním čase).
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
        // Kolo 3 (K3a): cron routy autorizované CRON_SECRET (recompute-dynamic-pricing,
        // refresh-spotify) ho dostanou dál; ostatní berou x-internal-token.
        authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
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
