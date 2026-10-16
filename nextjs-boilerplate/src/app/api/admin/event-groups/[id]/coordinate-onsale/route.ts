/**
 * POST /api/admin/event-groups/[id]/coordinate-onsale
 *
 * TM-style Coordinated Onsale — všechna events v groupě spustí prodej současně.
 *
 * Body: { saleStartAt: ISO datetime, saleEndAt?: ISO datetime }
 *
 * Synchronně nastaví sale_start_at/sales_end_at na všech events v groupě (kolo 7: sales_end_at).
 * Audit do event_groups.bulk_edits.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const schema = z.object({
  saleStartAt: z.string().datetime(),
  saleEndAt: z.string().datetime().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: groupId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }

  const ownRes = await db().query(
    `SELECT 1 FROM event_groups.groups WHERE id = $1 AND promoter_id = $2`,
    [groupId, promoter.promoterId],
  );
  if (ownRes.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const affectedRes = await client.query<{ event_id: string }>(
      `SELECT event_id FROM event_groups.members WHERE group_id = $1`,
      [groupId],
    );
    const affectedIds = affectedRes.rows.map((r) => r.event_id);

    if (affectedIds.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NO_EVENTS_IN_GROUP' }, { status: 404 });
    }

    // Kolo 7 (C-29): uzávěrka po konci některé akce skupiny → srozumitelná 422 (jinak CHECK 23514 → 500).
    if (parsed.data.saleEndAt) {
      const late = await client.query<{ n: number }>(
        `SELECT count(*)::int n FROM catalog.events
          WHERE id = ANY($1::uuid[]) AND $2::timestamptz > COALESCE(date_end, date_start + INTERVAL '12 hours')`,
        [affectedIds, parsed.data.saleEndAt],
      );
      if ((late.rows[0]?.n ?? 0) > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'INVALID_SALES_END', message: 'Konec online prodeje nesmí být po konci žádné akce ve skupině.' },
          { status: 422 },
        );
      }
    }

    await client.query(
      `UPDATE catalog.events
          SET sale_start_at = $1::timestamptz,
              sales_end_at = COALESCE($2::timestamptz, sales_end_at), -- kolo 7: sale_end_at je zastaralý
              updated_at = NOW()
        WHERE id = ANY($3::uuid[])
          AND promoter_id = $4`,
      [parsed.data.saleStartAt, parsed.data.saleEndAt ?? null, affectedIds, promoter.promoterId],
    );

    await client.query(
      `UPDATE event_groups.groups
          SET onsale_coordinated_at = $2::timestamptz, updated_at = NOW()
        WHERE id = $1`,
      [groupId, parsed.data.saleStartAt],
    );

    await client.query(
      `INSERT INTO event_groups.bulk_edits
         (group_id, performed_by_user_id, event_count, field_changes, affected_events)
       VALUES ($1, $2, $3, $4::jsonb, $5::uuid[])`,
      [
        groupId, promoter.userId, affectedIds.length,
        JSON.stringify({
          sale_start_at: parsed.data.saleStartAt,
          sale_end_at: parsed.data.saleEndAt,
          action: 'coordinated_onsale',
        }),
        affectedIds,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      coordinatedAt: parsed.data.saleStartAt,
      eventCount: affectedIds.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[coordinate-onsale]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
