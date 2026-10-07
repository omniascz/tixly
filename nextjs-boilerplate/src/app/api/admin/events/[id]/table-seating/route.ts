/**
 * GET    /api/admin/events/[id]/table-seating  — list existing table seats (sector LIKE 'Stůl %')
 * POST   /api/admin/events/[id]/table-seating  — regenerate table layout (delete + insert)
 *        Body: { tableCount: number, seatsPerTable: number, shape: 'round'|'square', ticketTypeId?: string }
 * DELETE /api/admin/events/[id]/table-seating  — delete all table seats
 *
 * Auth: runAsActivePromoter + event ownership check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

const postSchema = z.object({
  tableCount: z.number().int().min(1).max(200),
  seatsPerTable: z.number().int().min(1).max(20),
  shape: z.enum(['round', 'square']),
  ticketTypeId: z.string().uuid().optional().nullable(),
});

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{
      id: string;
      sector: string;
      row: string;
      seat_number: string;
      status: string;
      ticket_type_id: string | null;
    }>(
      `SELECT id, sector, row, seat_number, status, ticket_type_id
       FROM catalog.event_seats
       WHERE event_id = $1 AND sector LIKE 'Stůl %'
       ORDER BY sector, seat_number::int`,
      [params.id],
    );

    // Aggregate summary
    const tableMap: Record<string, number> = {};
    for (const row of r.rows) {
      tableMap[row.sector] = (tableMap[row.sector] ?? 0) + 1;
    }
    const tableCount = Object.keys(tableMap).length;
    const seatsPerTable = tableCount > 0 ? Math.round(r.rows.length / tableCount) : 0;

    return NextResponse.json({
      eventId: params.id,
      totalSeats: r.rows.length,
      tableCount,
      seatsPerTable,
      seats: r.rows,
    });
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'BAD_INPUT', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const { tableCount, seatsPerTable, ticketTypeId } = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // Delete existing table seats for this event
      await client.query(
        `DELETE FROM catalog.event_seats
         WHERE event_id = $1 AND sector LIKE 'Stůl %'`,
        [params.id],
      );

      // Insert new table seats
      const totalToInsert = tableCount * seatsPerTable;
      if (totalToInsert > 0) {
        // Build bulk insert values
        const values: string[] = [];
        const args: unknown[] = [params.id, ticketTypeId ?? null];
        let idx = 3;

        for (let t = 1; t <= tableCount; t++) {
          const sectorName = `Stůl ${t}`;
          for (let s = 1; s <= seatsPerTable; s++) {
            values.push(`($1, $${idx++}, $${idx++}, $${idx++}, 'available', $2)`);
            args.push(sectorName, '', String(s));
          }
        }

        await client.query(
          `INSERT INTO catalog.event_seats
             (event_id, sector, row, seat_number, status, ticket_type_id)
           VALUES ${values.join(', ')}`,
          args,
        );
      }

      await client.query('COMMIT');

      return NextResponse.json({
        ok: true,
        tableCount,
        seatsPerTable,
        totalSeats: tableCount * seatsPerTable,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST table-seating]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM catalog.event_seats
         WHERE event_id = $1 AND sector LIKE 'Stůl %'
         RETURNING id
       ) SELECT COUNT(*)::text AS count FROM deleted`,
      [params.id],
    );

    return NextResponse.json({ ok: true, deleted: Number(r.rows[0]?.count ?? 0) });
  });
}
