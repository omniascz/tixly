/**
 * GET /api/admin/events/[id] — detail
 * PATCH /api/admin/events/[id] — edit
 *
 * Auth: requirePromoter, MUSÍ vlastnit akci.
 *
 * Při významném edit (změna title, description) vrátíme akci do moderation flow:
 * status='pending_review' (kromě případu, kdy auto-publish ji znovu povolí).
 * To chrání před scenarios kde promotér nejdřív upublishuje benign akci a po
 * schválení ji "podstrčí" se zakázaným obsahem.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { runAiGate, TRUST_THRESHOLD_PUBLISHED_EVENTS } from '@/lib/moderation/ai-gate';
import { notifyFollowers } from '@/lib/push/notify-followers';
import { validateSalesEndAt } from '@/lib/sales/cutoff';
import { vatNotReadyResponse } from '@/lib/tax/vat-readiness';


interface EventDetailRow {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  status: string;
  min_age: number | null;
  promoter_id: string;
  venue_id: string | null;
  currency: string;
  queue_enabled: boolean;
  queue_max_concurrent: number;
  insurance_enabled: boolean;
  insurance_pct: number;
  cover_image_url: string | null;
}

interface PartialMatch {
  keyword: string;
  category: string;
  severity: string;
}

const editSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  dateStart: z.string().datetime().optional(),
  minAge: z.number().int().min(0).max(99).nullable().optional(),
  // Advanced settings (Phase I.1)
  queueEnabled: z.boolean().optional(),
  queueMaxConcurrent: z.number().int().min(1).max(100_000).optional(),
  insuranceEnabled: z.boolean().optional(),
  insurancePct: z.number().int().min(0).max(50).optional(),
  // CZ/SK launch — per-event refund + QR + DPH policy (migrace 265)
  refundDeadlineDays: z.number().int().min(0).max(90).nullable().optional(),
  refundFeePct: z.number().int().min(0).max(10000).nullable().optional(),
  refundFeeMinHalire: z.number().int().min(0).max(100_000).nullable().optional(),
  qrPolicy: z.enum(['static_allowed', 'rotating_24h', 'rotating_only', 'photo_required']).optional(),
  // Re-entry (festival/open-air): povolí opakovaný vstup/výstup u brány.
  // reentryMaxCount = max počet entry scanů (1 = single, >1 = re-entry).
  reentryAllowed: z.boolean().optional(),
  reentryMaxCount: z.number().int().min(1).max(100).optional(),
  // Prodleva mezi dvěma průchody téže vstupenky. Chrání před dvojím načtením
  // kódu, kdy by se stav překlopil a naúčtoval průchod, který se nestal.
  reentryCooldownSeconds: z.number().int().min(0).max(3600).optional(),
  // Kolo 7 (C-29): konec online prodeje; null = začátek akce. Nesmí být po konci akce.
  salesEndAt: z.string().datetime().nullable().optional(),
  // Eventim Pass-style — kolik minut před eventem se QR kód odhalí buyerovi.
  // 0 = až při startu eventu, 999999 = okamžitě (vhodné pro standard kulturní akce).
  qrRevealMinutesBefore: z.number().int().min(0).max(999999).optional(),
  vatCategory: z.enum(['standard', 'cultural', 'food_beverage', 'merchandise', 'reduced']).optional(),
  // P1.5 + P1.8 admin toggles — Verified Fan presale gate + OTP SMS validation.
  // Bez UI toggle buyer flow nikdy nedostane šanci tyto gates vidět.
  verifiedFanEnabled: z.boolean().optional(),
  requiresOtpValidation: z.boolean().optional(),
  requirePhoneVerified: z.boolean().optional(),
  // mig 433 — purchase limit per event
  maxTicketsPerBuyer: z.number().int().min(1).max(1000).nullable().optional(),
  // mig 445 — poctivá cena: záruka, že dynamic pricing nikdy nezdraží nad base
  noSurgePledge: z.boolean().optional(),
  // mig 446 — EUDI peněženka: které důkazy akce vyžaduje (selektivní zveřejnění)
  eudiRequired: z
    .object({
      age18: z.boolean().optional(),
      samePerson: z.boolean().optional(),
      residency: z.string().max(2).nullable().optional(),
    })
    .nullable()
    .optional(),
  // mig 447 — CO₂ štítek: očekávaná průměrná jednosměrná vzdálenost dojezdu (km)
  avgTripKm: z.number().int().min(0).max(2000).nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const r = await db().query<
    EventDetailRow & {
      refund_deadline_days: number | null;
      refund_fee_pct: number | null;
      refund_fee_min_halire: number | null;
      qr_policy: string;
      vat_category: string;
    }
  >(
    `SELECT id, title, description, date_start, date_end, sales_end_at, status, min_age, promoter_id, venue_id,
            currency, queue_enabled, queue_max_concurrent, insurance_enabled, insurance_pct,
            refund_deadline_days, refund_fee_pct, refund_fee_min_halire,
            qr_policy, vat_category,
            COALESCE(verified_fan_enabled, FALSE) AS verified_fan_enabled,
            COALESCE(requires_otp_validation, FALSE) AS requires_otp_validation,
            COALESCE(reentry_allowed, FALSE) AS reentry_allowed,
            COALESCE(reentry_max_count, 3) AS reentry_max_count,
            COALESCE(reentry_cooldown_seconds, 10) AS reentry_cooldown_seconds,
            max_tickets_per_buyer,
            (to_jsonb(events.*) ->> 'no_surge_pledge')::boolean AS no_surge_pledge,
            (to_jsonb(events.*) -> 'eudi_required') AS eudi_required,
            (to_jsonb(events.*) ->> 'avg_trip_km')::int AS avg_trip_km
     FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [params.id, promoter.promoterId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const e = r.rows[0];
  return NextResponse.json({
    id: e.id,
    title: e.title,
    description: e.description,
    dateStart: e.date_start,
    dateEnd: (e as { date_end?: string | null }).date_end ?? null,
    salesEndAt: (e as { sales_end_at?: string | null }).sales_end_at ?? null,
    status: e.status,
    minAge: e.min_age,
    currency: e.currency,
    queueEnabled: e.queue_enabled,
    queueMaxConcurrent: e.queue_max_concurrent,
    insuranceEnabled: e.insurance_enabled,
    insurancePct: e.insurance_pct,
    verifiedFanEnabled: (e as { verified_fan_enabled?: boolean }).verified_fan_enabled ?? false,
    requiresOtpValidation: (e as { requires_otp_validation?: boolean }).requires_otp_validation ?? false,
    refundDeadlineDays: e.refund_deadline_days,
    refundFeePct: e.refund_fee_pct,
    refundFeeMinHalire: e.refund_fee_min_halire,
    qrPolicy: e.qr_policy,
    vatCategory: e.vat_category,
    reentryAllowed: (e as { reentry_allowed?: boolean }).reentry_allowed ?? false,
    reentryMaxCount: (e as { reentry_max_count?: number }).reentry_max_count ?? 3,
    reentryCooldownSeconds:
      (e as { reentry_cooldown_seconds?: number }).reentry_cooldown_seconds ?? 10,
    maxTicketsPerBuyer: (e as { max_tickets_per_buyer?: number | null }).max_tickets_per_buyer ?? null,
    noSurgePledge: (e as { no_surge_pledge?: boolean | null }).no_surge_pledge ?? false,
    eudiRequired: (e as { eudi_required?: unknown }).eudi_required ?? null,
    avgTripKm: (e as { avg_trip_km?: number | null }).avg_trip_km ?? null,
  });

  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query<EventDetailRow>(
      `SELECT id, title, description, date_start, date_end, sales_end_at, status, min_age, promoter_id, venue_id, cover_image_url
       FROM catalog.events WHERE id = $1 AND promoter_id = $2 FOR UPDATE`,
      [params.id, promoter.promoterId],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const event = cur.rows[0];

    const newTitle = input.title ?? event.title;
    const newDescription =
      input.description !== undefined ? input.description : event.description;
    const newDateStart = input.dateStart ?? event.date_start;
    // Kolo 7 (C-29): uzávěrka online prodeje nesmí být po konci akce (bez konce akce po začátku + 12 h).
    {
      const ev = event as unknown as { date_end: string | null; sales_end_at: string | null };
      const newSalesEnd = input.salesEndAt !== undefined ? input.salesEndAt : ev.sales_end_at;
      const err = validateSalesEndAt(newSalesEnd, { date_start: newDateStart, date_end: ev.date_end });
      if (err) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'INVALID_SALES_END', message: err }, { status: 422 });
      }
    }
    const newMinAge =
      input.minAge !== undefined ? (input.minAge && input.minAge > 0 ? input.minAge : null) : event.min_age;

    // Re-moderation pokud se změnil title nebo description (#217 vrstvy 1+2)
    const significantChange =
      input.title !== undefined && input.title !== event.title ||
      input.description !== undefined && input.description !== event.description;

    let newStatus = event.status;
    let aiReasoning: string | null = null;

    if (significantChange) {
      // Vrstva 1: keyword blocklist scan na nový obsah
      const blocklist = await client.query<PartialMatch>(
        `SELECT keyword, category, severity FROM catalog.moderation_blocklist`,
      );
      const haystack = (newTitle + ' ' + (newDescription ?? '')).toLowerCase();
      const matched = blocklist.rows.filter((m) =>
        haystack.includes(m.keyword.toLowerCase()),
      );
      const autoReject = matched.some((m) => m.severity === 'auto_reject');

      if (autoReject) {
        newStatus = 'rejected';
      } else {
        // Vrstva 2: AI gate
        const trustRes = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM catalog.events
           WHERE promoter_id = $1 AND status = 'published'
             AND created_at > NOW() - INTERVAL '90 days' AND id <> $2`,
          [promoter.promoterId, event.id],
        );
        const trusted =
          Number(trustRes.rows[0]?.count ?? 0) >= TRUST_THRESHOLD_PUBLISHED_EVENTS;
        const gate = await runAiGate(
          {
            title: newTitle,
            description: newDescription ?? undefined,
            ticketTypeNames: [],
            coverImageUrl: event.cover_image_url,
          },
          trusted,
        );
        newStatus = gate.status;
        aiReasoning = [gate.ai.reasoning, gate.image ? `[plakát] ${gate.image.reasoning}` : null]
          .filter(Boolean)
          .join(' · ');
      }
    }

    await client.query(
      `UPDATE catalog.events
       SET title = $1, description = $2, date_start = $3, min_age = $4,
           status = $5,
           queue_enabled = COALESCE($7, queue_enabled),
           queue_max_concurrent = COALESCE($8, queue_max_concurrent),
           insurance_enabled = COALESCE($9, insurance_enabled),
           insurance_pct = COALESCE($10, insurance_pct),
           refund_deadline_days = COALESCE($11, refund_deadline_days),
           refund_fee_pct = COALESCE($12, refund_fee_pct),
           refund_fee_min_halire = COALESCE($13, refund_fee_min_halire),
           qr_policy = COALESCE($14, qr_policy),
           vat_category = COALESCE($15, vat_category),
           qr_reveal_minutes_before = COALESCE($16, qr_reveal_minutes_before),
           verified_fan_enabled = COALESCE($17, verified_fan_enabled),
           requires_otp_validation = COALESCE($18, requires_otp_validation),
           reentry_allowed = COALESCE($19, reentry_allowed),
           reentry_max_count = COALESCE($20, reentry_max_count),
           require_phone_verified = COALESCE($21, require_phone_verified),
           max_tickets_per_buyer = CASE WHEN $22::int IS NOT NULL THEN $22 ELSE max_tickets_per_buyer END,
           reentry_cooldown_seconds = COALESCE($23, reentry_cooldown_seconds),
           sales_end_at = CASE WHEN $24::boolean THEN $25::timestamptz ELSE sales_end_at END,
           updated_at = NOW()
       WHERE id = $6`,
      [
        newTitle, newDescription, newDateStart, newMinAge, newStatus, event.id,
        input.queueEnabled ?? null,
        input.queueMaxConcurrent ?? null,
        input.insuranceEnabled ?? null,
        input.insurancePct ?? null,
        input.refundDeadlineDays ?? null,
        input.refundFeePct ?? null,
        input.refundFeeMinHalire ?? null,
        input.qrPolicy ?? null,
        input.vatCategory ?? null,
        input.qrRevealMinutesBefore ?? null,
        input.verifiedFanEnabled ?? null,
        input.requiresOtpValidation ?? null,
        input.reentryAllowed ?? null,
        input.reentryMaxCount ?? null,
        input.requirePhoneVerified ?? null,
        input.maxTicketsPerBuyer !== undefined ? (input.maxTicketsPerBuyer ?? null) : null,
        input.reentryCooldownSeconds ?? null,
        input.salesEndAt !== undefined,
        input.salesEndAt ?? null,
      ],
    );

    // no_surge_pledge zvlášť přes savepoint — migračně bezpečné (když sloupec ještě
    // neexistuje, savepoint se odroluje a zbytek editu proběhne).
    if (input.noSurgePledge !== undefined) {
      await client.query('SAVEPOINT sp_pledge');
      try {
        await client.query(
          `UPDATE catalog.events SET no_surge_pledge = $1 WHERE id = $2`,
          [input.noSurgePledge, event.id],
        );
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT sp_pledge');
      }
    }

    // eudi_required (mig 446) — také přes savepoint (migračně bezpečné).
    if (input.eudiRequired !== undefined) {
      await client.query('SAVEPOINT sp_eudi');
      try {
        await client.query(
          `UPDATE catalog.events SET eudi_required = $1::jsonb WHERE id = $2`,
          [input.eudiRequired ? JSON.stringify(input.eudiRequired) : null, event.id],
        );
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT sp_eudi');
      }
    }

    // avg_trip_km (mig 447) — savepoint (migračně bezpečné).
    if (input.avgTripKm !== undefined) {
      await client.query('SAVEPOINT sp_trip');
      try {
        await client.query(
          `UPDATE catalog.events SET avg_trip_km = $1 WHERE id = $2`,
          [input.avgTripKm, event.id],
        );
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT sp_trip');
      }
    }

    if (significantChange) {
      const decision =
        newStatus === 'rejected'
          ? 'rejected'
          : newStatus === 'published'
            ? 'approved'
            : 'submitted';
      await client.query(
        `INSERT INTO audit.event_moderation_log
           (event_id, actor_user_id, actor_type, decision, reason)
         VALUES ($1, $2, 'auto_ai', $3, $4)`,
        [event.id, promoter.userId, decision, `Re-moderation po editu: ${aiReasoning ?? 'keyword auto-reject'}`],
      );
    }

    const becamePublished = event.status !== 'published' && newStatus === 'published';
    // Kolo 7 (C-54): publikace jen s připraveným DPH.
    if (becamePublished) {
      const vatBlocked = await vatNotReadyResponse(client, event.id, 'publish');
      if (vatBlocked) {
        await client.query('ROLLBACK');
        return vatBlocked;
      }
    }

    await client.query('COMMIT');

    // Push notification followerům promotéra (post-commit, fire-and-forget)
    if (becamePublished) {
      void notifyFollowers({
        promoterId: promoter.promoterId,
        eventId: event.id,
        eventTitle: newTitle,
      }).catch((e) => console.error('[push followers] failed:', e));
    }

    return NextResponse.json({ ok: true, id: event.id, status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/admin/events/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
