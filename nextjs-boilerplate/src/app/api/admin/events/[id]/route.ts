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
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';
import { runAiGate, TRUST_THRESHOLD_PUBLISHED_EVENTS } from '@/lib/moderation/ai-gate';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

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
  vatCategory: z.enum(['standard', 'cultural', 'food_beverage', 'merchandise', 'reduced']).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    `SELECT id, title, description, date_start, status, min_age, promoter_id, venue_id,
            currency, queue_enabled, queue_max_concurrent, insurance_enabled, insurance_pct,
            refund_deadline_days, refund_fee_pct, refund_fee_min_halire,
            qr_policy, vat_category
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
    status: e.status,
    minAge: e.min_age,
    currency: e.currency,
    queueEnabled: e.queue_enabled,
    queueMaxConcurrent: e.queue_max_concurrent,
    insuranceEnabled: e.insurance_enabled,
    insurancePct: e.insurance_pct,
    refundDeadlineDays: e.refund_deadline_days,
    refundFeePct: e.refund_fee_pct,
    refundFeeMinHalire: e.refund_fee_min_halire,
    qrPolicy: e.qr_policy,
    vatCategory: e.vat_category,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
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
      `SELECT id, title, description, date_start, status, min_age, promoter_id, venue_id
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
          { title: newTitle, description: newDescription ?? undefined, ticketTypeNames: [] },
          trusted,
        );
        newStatus = gate.status;
        aiReasoning = gate.ai.reasoning;
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
      ],
    );

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

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, id: event.id, status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PATCH /api/admin/events/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
