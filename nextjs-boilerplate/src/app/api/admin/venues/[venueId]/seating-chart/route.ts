/**
 * GET  /api/admin/venues/[venueId]/seating-chart — promoter-readable layout (event setup).
 * POST — Uloží nový seating chart. Povoleno pro promotéra pokud je venue.promoter_id = tento promotér.
 *         Sdílené sály (promoter_id IS NULL) edituje pouze platform admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { layoutErrorMessage, layoutSchema } from '@/lib/seating/layout-schema';

// Kolo 8 / krok 2: stejné schéma jako editor a platformní routa (dřív {id,label} → plánek pořadatele
// nešel uložit); typy míst, cenové zóny, podklad, odmítnutí duplicitních míst.
const postSchema = z.object({
  name: z.string().min(1).max(200),
  layout: layoutSchema,
  notes: z.string().max(2000).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { venueId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (_promoter) => {
    const r = await db().query<{
      id: string;
      name: string;
      layout: unknown;
      total_seats: number;
    }>(
      `SELECT id, name, layout, total_seats FROM catalog.venue_seating_charts
       WHERE venue_id = $1 AND active = true
       ORDER BY created_at DESC LIMIT 1`,
      [params.venueId],
    );
    if (r.rows.length === 0) return NextResponse.json({ chart: null });
    return NextResponse.json({ chart: r.rows[0] });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { venueId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    // Pouze pokud venue patří tomuto promotérovi
    const venueRow = await db().query<{ promoter_id: string | null }>(
      `SELECT promoter_id FROM catalog.venues WHERE id = $1 LIMIT 1`,
      [params.venueId],
    );
    if (venueRow.rows.length === 0) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }
    const vPromoter = venueRow.rows[0].promoter_id;
    if (vPromoter !== promoter.promoterId) {
      return NextResponse.json(
        {
          error: 'Forbidden',
          reason: 'Sdílené sály edituje pouze Tixly admin. Vytvořte si vlastní soukromý sál přes /admin/venues/new, nebo kontaktujte podporu.',
        },
        { status: 403 },
      );
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: layoutErrorMessage(parsed.error.issues), issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const input = parsed.data;

    const totalSeats = input.layout.sectors.reduce(
      (s, sec) => s + sec.rows.reduce((rs, row) => rs + row.seats.length, 0),
      0,
    );

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Deaktivovat stávající charty
      await client.query(
        `UPDATE catalog.venue_seating_charts SET active = false WHERE venue_id = $1`,
        [params.venueId],
      );
      const r = await client.query<{ id: string }>(
        `INSERT INTO catalog.venue_seating_charts
           (venue_id, name, layout, total_seats, active, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, true, $5, $6)
         RETURNING id`,
        [
          params.venueId,
          input.name,
          JSON.stringify(input.layout),
          totalSeats,
          input.notes ?? null,
          promoter.userId,
        ],
      );
      // Aktualizovat kapacitu venues
      await client.query(
        `UPDATE catalog.venues SET capacity = $1 WHERE id = $2`,
        [totalSeats, params.venueId],
      );
      await client.query('COMMIT');
      return NextResponse.json({ id: r.rows[0].id, totalSeats }, { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST seating-chart admin]', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
