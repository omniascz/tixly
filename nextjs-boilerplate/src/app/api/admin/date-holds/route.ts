/**
 * GET  /api/admin/date-holds?from=&to=&venueId= — kalendář opcí a potvrzených termínů
 * POST /api/admin/date-holds — nová opce na termín
 *
 * Kalendář je pohledem **pořadatele**, ne sálu: chce vidět svoje termíny napříč
 * všemi sály, včetně toho, kolikátý je v pořadí a kdy mu propadne lhůta.
 * Vedle opcí vrací i už potvrzené akce, aby byl v jednom pohledu celý měsíc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter, runAsPromoter } from '@/lib/admin-auth';
import { nextOptionRank, type DateHold } from '@/lib/booking/date-holds';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const postSchema = z.object({
  venueId: z.string().uuid(),
  holdDate: z.string().regex(DATE_RE),
  title: z.string().min(1).max(200),
  artistName: z.string().max(200).optional(),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().max(200).optional(),
  /** Lhůta na potvrzení. Bez ní opce drží, dokud ji někdo nepustí. */
  expiresAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const from = req.nextUrl.searchParams.get('from');
    const to = req.nextUrl.searchParams.get('to');
    const venueId = req.nextUrl.searchParams.get('venueId');
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json(
        { error: 'BAD_RANGE', message: 'Zadej rozsah from a to ve tvaru RRRR-MM-DD.' },
        { status: 422 },
      );
    }

    const args: unknown[] = [ctx.promoterId, from, to];
    let venueClause = '';
    if (venueId && /^[0-9a-f-]{36}$/i.test(venueId)) {
      args.push(venueId);
      venueClause = ` AND h.venue_id = $${args.length}`;
    }

    const holds = await db().query<{
      id: string;
      venue_id: string;
      venue_name: string;
      hold_date: string;
      option_rank: number;
      title: string;
      artist_name: string | null;
      expires_at: string | null;
      status: string;
      event_id: string | null;
    }>(
      `SELECT h.id, h.venue_id, v.name AS venue_name, h.hold_date::text AS hold_date,
              h.option_rank, h.title, h.artist_name, h.expires_at, h.status, h.event_id
       FROM catalog.venue_date_holds h
       JOIN catalog.venues v ON v.id = h.venue_id
       WHERE h.promoter_id = $1
         AND h.hold_date BETWEEN $2::date AND $3::date
         AND h.status IN ('held', 'confirmed')
         ${venueClause}
       ORDER BY h.hold_date, v.name, h.option_rank`,
      args,
    );

    // Potvrzené akce, které vznikly mimo opce — aby kalendář nelhal.
    const events = await db().query<{
      id: string;
      title: string;
      date_start: string;
      venue_id: string | null;
      venue_name: string | null;
    }>(
      `SELECT e.id, e.title, e.date_start::text AS date_start, e.venue_id, v.name AS venue_name
       FROM catalog.events e
       LEFT JOIN catalog.venues v ON v.id = e.venue_id
       WHERE e.promoter_id = $1
         AND e.date_start::date BETWEEN $2::date AND $3::date`,
      [ctx.promoterId, from, to],
    );

    return NextResponse.json({
      holds: holds.rows.map((h) => ({
        id: h.id,
        venueId: h.venue_id,
        venueName: h.venue_name,
        date: h.hold_date,
        optionRank: h.option_rank,
        title: h.title,
        artistName: h.artist_name,
        expiresAt: h.expires_at,
        status: h.status,
        eventId: h.event_id,
      })),
      events: events.rows.map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date_start.slice(0, 10),
        venueId: e.venue_id,
        venueName: e.venue_name,
      })),
    });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const b = parsed.data;

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const venue = await client.query(
        `SELECT 1 FROM catalog.venues WHERE id = $1 AND (promoter_id = $2 OR promoter_id IS NULL)`,
        [b.venueId, promoter.promoterId],
      );
      if (venue.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'VENUE_NOT_FOUND' }, { status: 404 });
      }

      // Existující opce na ten den — zamykáme, aby dva souběžné požadavky
      // nedostaly stejné pořadí.
      const existing = await client.query<{ id: string; option_rank: number; status: string }>(
        `SELECT id, option_rank, status
         FROM catalog.venue_date_holds
         WHERE venue_id = $1 AND hold_date = $2::date
         FOR UPDATE`,
        [b.venueId, b.holdDate],
      );

      if (existing.rows.some((h) => h.status === 'confirmed')) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'DATE_CONFIRMED',
            message: 'Termín je už potvrzený. Opci na něj držet nemá smysl.',
          },
          { status: 409 },
        );
      }

      const rank = nextOptionRank(
        existing.rows.map(
          (h): DateHold => ({
            id: h.id,
            optionRank: h.option_rank,
            status: h.status as DateHold['status'],
          }),
        ),
      );

      const ins = await client.query<{ id: string }>(
        `INSERT INTO catalog.venue_date_holds
           (venue_id, promoter_id, hold_date, option_rank, title, artist_name,
            contact_name, contact_email, expires_at, notes, created_by_user_id)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          b.venueId,
          promoter.promoterId,
          b.holdDate,
          rank,
          b.title,
          b.artistName ?? null,
          b.contactName ?? null,
          b.contactEmail ?? null,
          b.expiresAt ?? null,
          b.notes ?? null,
          promoter.userId,
        ],
      );

      await client.query('COMMIT');
      return NextResponse.json(
        {
          ok: true,
          id: ins.rows[0].id,
          optionRank: rank,
          message:
            rank === 1
              ? 'Termín držíš jako první v pořadí.'
              : `Termín držíš jako ${rank}. v pořadí — potvrdit může až první.`,
        },
        { status: 201 },
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST date-holds]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
