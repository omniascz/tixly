import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

async function assertOwner(agreementId: string, promoterId: string) {
  const r = await runWithServiceContext(() =>
    db().query(
      `SELECT a.id FROM lineups.royalty_agreements a WHERE a.id=$1 AND a.promoter_id=$2 LIMIT 1`,
      [agreementId, promoterId],
    ),
  );
  return r.rows.length > 0;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; agreementId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.agreementId, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const b = await req.json() as Record<string, unknown>;
    const allowed = [
      'artist_name','artist_email','bank_iban','bank_bic',
      'royalty_type','percent_rate','flat_amount_halire',
      'per_ticket_halire','min_guarantee_halire','cap_halire',
      'included_ticket_type_ids','status','notes',
    ];
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const key of allowed) {
      if (key in b) { fields.push(`${key}=$${i++}`); values.push(b[key]); }
    }
    if (fields.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    fields.push(`updated_at=NOW()`);
    values.push(params.agreementId);
    const r = await runWithServiceContext(() =>
      db().query(
        `UPDATE lineups.royalty_agreements SET ${fields.join(',')} WHERE id=$${i} RETURNING *`,
        values,
      ),
    );
    return NextResponse.json(r.rows[0]);
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; agreementId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.agreementId, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Smazat jen pokud není žádný ledger záznam (ochrana integrity)
    const ledger = await runWithServiceContext(() =>
      db().query(`SELECT 1 FROM lineups.royalty_ledger WHERE agreement_id=$1 LIMIT 1`, [params.agreementId]),
    );
    if (ledger.rows.length > 0) {
      return NextResponse.json({ error: 'Cannot delete — ledger entries exist. Cancel instead.' }, { status: 409 });
    }
    await runWithServiceContext(() =>
      db().query(`DELETE FROM lineups.royalty_agreements WHERE id=$1`, [params.agreementId]),
    );
    return NextResponse.json({ ok: true });
  });
}

/** GET — ledger záznamy pro tuto smlouvu */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; agreementId: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    if (!(await assertOwner(params.agreementId, ctx.promoterId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT l.id, l.order_id, l.ticket_revenue_halire, l.tickets_sold,
                l.royalty_amount_halire, l.created_at
         FROM lineups.royalty_ledger l
         WHERE l.agreement_id=$1
         ORDER BY l.created_at DESC
         LIMIT 100`,
        [params.agreementId],
      ),
    );
    return NextResponse.json({ entries: r.rows });
  });
}
