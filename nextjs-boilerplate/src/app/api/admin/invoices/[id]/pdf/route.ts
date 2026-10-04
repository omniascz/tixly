/**
 * GET /api/admin/invoices/[id]/pdf — PDF daňového dokladu / dobropisu pořadatele.
 *
 * Kolo 7 (C-54): jednotný model z lib/accounting/documents.ts (stejný jako ISDOC) — rozpis po sazbách,
 * neplátce bez DPH, dobropis se zápornými částkami a odkazem na opravovaný doklad.
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadTaxDocument } from '@/lib/accounting/documents';
import { buildInvoicePdf } from '@/lib/accounting/invoice-pdf';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { asSystemInTx, db } from '@/lib/db/rls-pool';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    const own = await db().query(`SELECT 1 FROM orders.invoices WHERE id = $1 AND promoter_id = $2`, [params.id, promoter.promoterId]);
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const doc = await asSystemInTx(client, () => loadTaxDocument(client, params.id));
      await client.query('COMMIT');
      if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const pdf = await buildInvoicePdf(doc);
      return new Response(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="doklad-${doc.number}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
