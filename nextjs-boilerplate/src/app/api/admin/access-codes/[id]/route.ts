/**
 * DELETE /api/admin/access-codes/[id] — smaže přístupový kód (cascade na vazby)
 *
 * Pokud byl ticket_type vázaný jen na tento kód, vrací se visibility na 'public'.
 * Pokud zbývají vazby, nechává 'access_code'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // Ověř vlastnictví + vytáhni ticket_type_ids
    const r = await client.query<{ id: string; ticket_type_id: string }>(
      `SELECT ac.id, actt.ticket_type_id
       FROM catalog.access_codes ac
       LEFT JOIN catalog.access_code_ticket_types actt ON actt.access_code_id = ac.id
       WHERE ac.id = $1 AND ac.promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const ticketTypeIds = Array.from(
      new Set(r.rows.map((row) => row.ticket_type_id).filter(Boolean)),
    );

    // Smaž kód (cascade na access_code_ticket_types)
    await client.query(`DELETE FROM catalog.access_codes WHERE id = $1`, [params.id]);

    // Pro ticket_types, které nemají jiné aktivní kódy, vrátit visibility na 'public'
    if (ticketTypeIds.length > 0) {
      await client.query(
        `UPDATE catalog.ticket_types tt
           SET visibility = 'public'
         WHERE tt.id = ANY($1::uuid[])
           AND tt.visibility = 'access_code'
           AND NOT EXISTS (
             SELECT 1 FROM catalog.access_code_ticket_types actt
             WHERE actt.ticket_type_id = tt.id
           )`,
        [ticketTypeIds],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
