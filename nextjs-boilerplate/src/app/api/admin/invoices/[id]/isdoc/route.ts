/**
 * GET /api/admin/invoices/[id]/isdoc — ISDOC 6.0.2 dokladu / dobropisu pořadatele.
 *
 * Kolo 7 (C-54): z jednotného modelu (lib/accounting/documents.ts), výstup ověřený proti oficiálnímu
 * XSD v testech (src/lib/accounting/isdoc.test.ts). Předchozí generátor XSD neprošel.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadTaxDocument } from '@/lib/accounting/documents';
import { taxDocumentResponse } from '@/lib/accounting/render';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { asSystemInTx, db } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPromoterNonStaff(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    const own = await db().query(`SELECT 1 FROM orders.invoices WHERE id = $1 AND promoter_id = $2`, [
      params.id,
      promoter.promoterId,
    ]);
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const doc = await asSystemInTx(client, () => loadTaxDocument(client, params.id));
      await client.query('COMMIT');
      if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return taxDocumentResponse(doc, 'isdoc');
    } finally {
      client.release();
    }
  });
}
