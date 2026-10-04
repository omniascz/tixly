/** GET /api/admin/commission-invoices/[id]?format=pdf|isdoc — vlastní faktura provize pořadatele. Kolo 7, C-54. */
import { NextRequest, NextResponse } from 'next/server';
import { loadCommissionTaxDocument } from '@/lib/accounting/commission';
import { taxDocumentResponse } from '@/lib/accounting/render';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { asSystemInTx, db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    const own = await db().query(`SELECT 1 FROM platform.commission_invoices WHERE id = $1 AND promoter_id = $2`, [
      params.id,
      promoter.promoterId,
    ]);
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const doc = await asSystemInTx(client, () => loadCommissionTaxDocument(client, params.id));
      await client.query('COMMIT');
      if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return taxDocumentResponse(doc, req.nextUrl.searchParams.get('format'));
    } finally {
      client.release();
    }
  });
}
