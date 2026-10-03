/**
 * POST /api/admin/date-holds/[holdId]/confirm
 *
 * Potvrdí termín: založí koncept akce s předvyplněným sálem, datem a názvem,
 * opci označí jako potvrzenou a ostatní opce na ten den zruší.
 *
 * Potvrdit smí jen první opce v pořadí — jinak by druhý zájemce mohl vyfouknout
 * termín tomu, kdo na něj má právo.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { canConfirm, type DateHold } from '@/lib/booking/date-holds';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Čas začátku akce; bez něj se použije 20:00 místního času. */
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

interface HoldRow {
  id: string;
  venue_id: string;
  hold_date: string;
  option_rank: number;
  status: string;
  title: string;
  artist_name: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { holdId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    const startTime = parsed.success ? (parsed.data.startTime ?? '20:00') : '20:00';

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const hr = await client.query<HoldRow>(
        `SELECT id, venue_id, hold_date::text AS hold_date, option_rank, status, title, artist_name
         FROM catalog.venue_date_holds
         WHERE id = $1 AND promoter_id = $2`,
        [params.holdId, promoter.promoterId],
      );
      const hold = hr.rows[0];
      if (!hold) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const sr = await client.query<HoldRow>(
        `SELECT id, venue_id, hold_date::text AS hold_date, option_rank, status, title, artist_name
         FROM catalog.venue_date_holds
         WHERE venue_id = $1 AND hold_date = $2::date
         FOR UPDATE`,
        [hold.venue_id, hold.hold_date],
      );

      const toDomain = (h: HoldRow): DateHold => ({
        id: h.id,
        optionRank: h.option_rank,
        status: h.status as DateHold['status'],
      });

      const verdict = canConfirm(toDomain(hold), sr.rows.map(toDomain));
      if (!verdict.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'CANNOT_CONFIRM', message: verdict.reason },
          { status: 409 },
        );
      }

      // Koncept akce — nepublikovaný, bez vstupenek. Potvrzení termínu není
      // spuštění prodeje.
      // Dva sloupce, které jsou NOT NULL a musí se vyplnit stejně jako při
      // běžném zakládání akce (viz POST /api/admin/events):
      //   • `organizer_id` — starší sloupec, plní se toutéž hodnotou jako promoter_id
      //   • `slug` — odvozený z názvu, s náhodnou koncovkou kvůli unikátnosti
      //     v rámci pořadatele
      const ev = await client.query<{ id: string }>(
        `INSERT INTO catalog.events
           (organizer_id, promoter_id, venue_id, title, date_start, status, slug)
         VALUES ($1, $1, $2, $3, ($4::date + $5::time), 'draft',
           regexp_replace(regexp_replace(lower(translate($3,
             'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ',
             'acdeeinorstuuyzacdeeinorstuuyz'
           )), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')
           || '-' || substring(gen_random_uuid()::text FROM 1 FOR 6))
         RETURNING id`,
        [promoter.promoterId, hold.venue_id, hold.title, hold.hold_date, startTime],
      );
      const eventId = ev.rows[0].id;

      await client.query(
        `UPDATE catalog.venue_date_holds
         SET status = 'confirmed', event_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [params.holdId, eventId],
      );

      // Ostatní opce na ten den padají — sál je obsazený.
      const dropped = await client.query<{ id: string }>(
        `UPDATE catalog.venue_date_holds
         SET status = 'released', updated_at = NOW()
         WHERE venue_id = $1 AND hold_date = $2::date AND id <> $3 AND status = 'held'
         RETURNING id`,
        [hold.venue_id, hold.hold_date, params.holdId],
      );

      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('catalog','venue_date_holds',$1,'UPDATE',$2,'user',$3::jsonb)`,
        [
          params.holdId,
          promoter.userId,
          JSON.stringify({
            kind: 'date_hold_confirm',
            event_id: eventId,
            dropped_options: dropped.rows.length,
          }),
        ],
      );

      await client.query('COMMIT');
      return NextResponse.json({
        ok: true,
        eventId,
        droppedOptions: dropped.rows.length,
        message:
          dropped.rows.length > 0
            ? `Termín potvrzen a založen koncept akce. Zrušeno ${dropped.rows.length} dalších opcí na ten den.`
            : 'Termín potvrzen a založen koncept akce.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[confirm date-hold]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
