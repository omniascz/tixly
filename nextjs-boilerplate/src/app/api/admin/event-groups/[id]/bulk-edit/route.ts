/**
 * POST /api/admin/event-groups/[id]/bulk-edit
 *
 * TM-style hromadná editace všech events v groupě.
 *
 * Body: { fields: { refundDeadlineDays?, qrPolicy?, minAge?, status?, ... } }
 *
 * Aplikuje update na všechna events v groupě v jedné transakci.
 * Audit log do event_groups.bulk_edits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const bulkEditSchema = z.object({
  fields: z.object({
    refundDeadlineDays: z.number().int().min(0).max(365).nullable().optional(),
    refundFeePct: z.number().int().min(0).max(100).nullable().optional(),
    minAge: z.number().int().min(0).max(99).nullable().optional(),
    qrPolicy: z.enum(['rotating', 'static', 'totp']).nullable().optional(),
    vatCategory: z.string().nullable().optional(),
    resaleAllowed: z.boolean().optional(),
    maxTicketsPerOrder: z.number().int().min(1).max(100).nullable().optional(),
  }),
  // Optional: pouze konkrétní events v groupě (default: všechny)
  eventIds: z.array(z.string().uuid()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: groupId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) {
    return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
  }

  // Verify ownership
  const ownRes = await db().query(
    `SELECT 1 FROM event_groups.groups WHERE id = $1 AND promoter_id = $2`,
    [groupId, promoter.promoterId],
  );
  if (ownRes.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bulkEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }
  const { fields, eventIds } = parsed.data;

  // Build SET clause dynamically
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  function addSet(col: string, val: unknown) {
    if (val !== undefined) {
      values.push(val);
      setClauses.push(`${col} = $${idx++}`);
    }
  }

  addSet('refund_deadline_days', fields.refundDeadlineDays);
  addSet('refund_fee_pct', fields.refundFeePct);
  addSet('min_age', fields.minAge);
  addSet('qr_policy', fields.qrPolicy);
  addSet('vat_category', fields.vatCategory);
  addSet('resale_allowed', fields.resaleAllowed);
  addSet('max_tickets_per_order', fields.maxTicketsPerOrder);

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'NO_FIELDS_TO_UPDATE' }, { status: 422 });
  }

  setClauses.push('updated_at = NOW()');

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Fetch affected events
    const affectedRes = await client.query<{ event_id: string }>(
      eventIds && eventIds.length > 0
        ? `SELECT event_id FROM event_groups.members
            WHERE group_id = $1 AND event_id = ANY($2::uuid[])`
        : `SELECT event_id FROM event_groups.members WHERE group_id = $1`,
      eventIds && eventIds.length > 0 ? [groupId, eventIds] : [groupId],
    );
    const affectedIds = affectedRes.rows.map((r) => r.event_id);

    if (affectedIds.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NO_EVENTS_IN_GROUP' }, { status: 404 });
    }

    // Apply update
    values.push(affectedIds);
    const updateSql = `UPDATE catalog.events SET ${setClauses.join(', ')}
                        WHERE id = ANY($${idx}::uuid[])
                          AND promoter_id = $${idx + 1}`;
    values.push(promoter.promoterId);
    await client.query(updateSql, values);

    // Audit log
    await client.query(
      `INSERT INTO event_groups.bulk_edits
         (group_id, performed_by_user_id, event_count, field_changes, affected_events)
       VALUES ($1, $2, $3, $4::jsonb, $5::uuid[])`,
      [
        groupId, promoter.userId, affectedIds.length,
        JSON.stringify(fields), affectedIds,
      ],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      updatedCount: affectedIds.length,
      affectedEventIds: affectedIds,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[bulk-edit]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
