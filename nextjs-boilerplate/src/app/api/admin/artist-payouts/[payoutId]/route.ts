/**
 * PATCH /api/admin/artist-payouts/[payoutId]
 * Aktualizuje status výplaty (approve, mark as paid, cancel, notes, adjustments).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { payoutId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const own = await runWithServiceContext(() =>
      db().query(
        `SELECT id, status, gross_royalties_halire FROM lineups.artist_payouts
         WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
        [params.payoutId, ctx.promoterId],
      ),
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const current = own.rows[0] as { id: string; status: string; gross_royalties_halire: number };

    const b = await req.json() as {
      status?: string;
      adjustments_halire?: number;
      payout_method?: string;
      external_ref?: string;
      notes?: string;
      paid_at?: string;
    };

    // Validace přechodů stavů
    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending:    ['approved', 'cancelled'],
      approved:   ['processing', 'cancelled'],
      processing: ['paid', 'failed'],
      failed:     ['pending', 'cancelled'],
    };
    if (b.status && !VALID_TRANSITIONS[current.status]?.includes(b.status)) {
      return NextResponse.json({
        error: `Invalid transition: ${current.status} → ${b.status}`,
      }, { status: 422 });
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (b.status) { fields.push(`status=$${i++}`); values.push(b.status); }

    // Přepočítat net při změně adjustments
    if (b.adjustments_halire !== undefined) {
      fields.push(`adjustments_halire=$${i++}`);
      values.push(b.adjustments_halire);
      fields.push(`net_payout_halire=$${i++}`);
      values.push(Math.max(0, current.gross_royalties_halire + b.adjustments_halire));
    }

    if (b.payout_method !== undefined) { fields.push(`payout_method=$${i++}`); values.push(b.payout_method); }
    if (b.external_ref  !== undefined) { fields.push(`external_ref=$${i++}`);  values.push(b.external_ref); }
    if (b.notes         !== undefined) { fields.push(`notes=$${i++}`);         values.push(b.notes); }

    if (b.status === 'paid') {
      fields.push(`paid_at=$${i++}`);
      values.push(b.paid_at ?? new Date().toISOString());
    }

    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    fields.push(`updated_at=NOW()`);
    values.push(params.payoutId);
    const r = await runWithServiceContext(() =>
      db().query(
        `UPDATE lineups.artist_payouts SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
        values,
      ),
    );
    return NextResponse.json(r.rows[0]);
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { payoutId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await runWithServiceContext(() =>
      db().query(
        `DELETE FROM lineups.artist_payouts
         WHERE id=$1 AND promoter_id=$2 AND status IN ('pending','cancelled')
         RETURNING id`,
        [params.payoutId, ctx.promoterId],
      ),
    );
    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'Not found or cannot delete non-pending payout' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  });
}
