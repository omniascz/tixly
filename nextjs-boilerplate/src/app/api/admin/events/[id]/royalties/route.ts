/**
 * GET  /api/admin/events/[id]/royalties — seznam royalty smluv pro akci
 * POST /api/admin/events/[id]/royalties — vytvoří novou smlouvu
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

async function assertOwner(eventId: string, promoterId: string): Promise<boolean> {
  const r = await runWithServiceContext(() =>
    db().query(`SELECT 1 FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`, [eventId, promoterId]),
  );
  return r.rows.length > 0;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT a.id, a.artist_id, a.artist_name, a.artist_email,
                a.bank_iban, a.bank_bic,
                a.royalty_type, a.percent_rate, a.flat_amount_halire,
                a.per_ticket_halire, a.min_guarantee_halire, a.cap_halire,
                a.included_ticket_type_ids, a.status, a.notes,
                a.created_at,
                COALESCE(l.total_royalty, 0)::int AS accrued_halire,
                COALESCE(l.total_tickets, 0)::int AS tickets_sold,
                COALESCE(l.total_revenue, 0)::int AS revenue_halire
         FROM lineups.royalty_agreements a
         LEFT JOIN (
           SELECT agreement_id,
                  SUM(royalty_amount_halire) AS total_royalty,
                  SUM(tickets_sold)          AS total_tickets,
                  SUM(ticket_revenue_halire) AS total_revenue
           FROM lineups.royalty_ledger
           GROUP BY agreement_id
         ) l ON l.agreement_id = a.id
         WHERE a.event_id=$1
         ORDER BY a.created_at`,
        [params.id],
      ),
    );
    return NextResponse.json({ agreements: r.rows });
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.id, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const b = await req.json() as {
      artist_id?: string;
      artist_name: string;
      artist_email?: string;
      bank_iban?: string;
      bank_bic?: string;
      royalty_type?: string;
      percent_rate?: number;
      flat_amount_halire?: number;
      per_ticket_halire?: number;
      min_guarantee_halire?: number;
      cap_halire?: number;
      included_ticket_type_ids?: string[];
      notes?: string;
    };
    if (!b.artist_name) return NextResponse.json({ error: 'artist_name required' }, { status: 400 });
    const royaltyType = b.royalty_type ?? 'percent';
    if (!['percent','flat','per_ticket','percent_plus_flat'].includes(royaltyType)) {
      return NextResponse.json({ error: 'Invalid royalty_type' }, { status: 400 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `INSERT INTO lineups.royalty_agreements
           (event_id, promoter_id, artist_id, artist_name, artist_email,
            bank_iban, bank_bic, royalty_type, percent_rate, flat_amount_halire,
            per_ticket_halire, min_guarantee_halire, cap_halire,
            included_ticket_type_ids, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          params.id, ctx.promoterId,
          b.artist_id ?? null, b.artist_name,
          b.artist_email ?? null, b.bank_iban ?? null, b.bank_bic ?? null,
          royaltyType, b.percent_rate ?? null, b.flat_amount_halire ?? null,
          b.per_ticket_halire ?? null, b.min_guarantee_halire ?? null, b.cap_halire ?? null,
          b.included_ticket_type_ids ?? null, b.notes ?? null,
        ],
      ),
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  });
}
