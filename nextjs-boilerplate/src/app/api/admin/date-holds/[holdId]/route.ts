/**
 * POST   /api/admin/date-holds/[holdId]/confirm  — potvrdí termín a založí koncept akce
 * DELETE /api/admin/date-holds/[holdId]          — pustí opci a posune pořadí
 *
 * Potvrdit smí jen první opce v pořadí. Potvrzením vzniká koncept akce
 * s předvyplněným sálem, datem a názvem — konec přepisování údajů z e-mailu
 * do formuláře. Ostatní opce na ten termín zároveň padají, protože sál
 * je obsazený.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { reorderAfterRelease, type DateHold } from '@/lib/booking/date-holds';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

interface HoldRow {
  id: string;
  venue_id: string;
  hold_date: string;
  option_rank: number;
  status: string;
  title: string;
  artist_name: string | null;
}

/** Načte opci i všechny ostatní na stejný termín, zamčené pro zápis. */
async function loadSiblings(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  holdId: string,
  promoterId: string,
): Promise<{ hold: HoldRow; siblings: HoldRow[] } | null> {
  const r = (await client.query(
    `SELECT id, venue_id, hold_date::text AS hold_date, option_rank, status, title, artist_name
     FROM catalog.venue_date_holds
     WHERE id = $1 AND promoter_id = $2`,
    [holdId, promoterId],
  )) as { rows: HoldRow[] };
  const hold = r.rows[0];
  if (!hold) return null;

  const s = (await client.query(
    `SELECT id, venue_id, hold_date::text AS hold_date, option_rank, status, title, artist_name
     FROM catalog.venue_date_holds
     WHERE venue_id = $1 AND hold_date = $2::date
     FOR UPDATE`,
    [hold.venue_id, hold.hold_date],
  )) as { rows: HoldRow[] };

  return { hold, siblings: s.rows };
}

const toDomain = (h: HoldRow): DateHold => ({
  id: h.id,
  optionRank: h.option_rank,
  status: h.status as DateHold['status'],
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: { holdId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const loaded = await loadSiblings(client, params.holdId, promoter.promoterId);
      if (!loaded) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (loaded.hold.status === 'confirmed') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'ALREADY_CONFIRMED',
            message: 'Potvrzený termín se ruší zrušením akce, ne opce.',
          },
          { status: 409 },
        );
      }

      await client.query(
        `UPDATE catalog.venue_date_holds
         SET status = 'released', updated_at = NOW() WHERE id = $1`,
        [params.holdId],
      );

      // Posun pořadí — z pohledu ostatních zájemců se termín uvolnil.
      const after = loaded.siblings.map((h) =>
        h.id === params.holdId ? { ...toDomain(h), status: 'released' as const } : toDomain(h),
      );
      const changes = reorderAfterRelease(after);
      for (const c of changes) {
        await client.query(
          `UPDATE catalog.venue_date_holds SET option_rank = $2, updated_at = NOW() WHERE id = $1`,
          [c.id, c.toRank],
        );
      }

      await client.query('COMMIT');
      return NextResponse.json({
        ok: true,
        promoted: changes.filter((c) => c.becamePrimary).map((c) => c.id),
        message:
          changes.some((c) => c.becamePrimary)
            ? 'Opce uvolněna, další v pořadí se posunula na první místo.'
            : 'Opce uvolněna.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DELETE date-hold]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
