/**
 * GET /api/buyer/orders/[orderId]/invoice — daňový doklad k zaplacené objednávce kupce (PDF).
 *
 * Kolo 7 (C-54): dřív DPH z jedné sazby pořadatele s výchozí hodnotou 0 % a číslo jako
 * MAX+1 (při souběhu duplicita). Teď sdílená služba lib/accounting/documents.ts: sazby z typů
 * vstupenek k datu zaplacení, rozpis po sazbách, u neplátce bez DPH, číslo z řady bez děr.
 * Vlastnictví objednávky se ověří pod kontextem kupce; vystavení běží systémově (asSystemInTx).
 */
import { NextRequest, NextResponse } from 'next/server';
import { issueOrderDocument, loadTaxDocument, TaxDocumentError } from '@/lib/accounting/documents';
import { buildInvoicePdf, documentTitle } from '@/lib/accounting/invoice-pdf';
import { runAsUser } from '@/lib/auth';
import { asSystemInTx, db } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest, props: { params: Promise<{ orderId: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsUser(req, async (userId) => {
    const { orderId } = params;
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
      return NextResponse.json({ error: 'INVALID_ID' }, { status: 400 });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const own = await client.query(
        `SELECT 1 FROM orders.orders WHERE id = $1 AND user_id = $2 AND status = 'paid'`,
        [orderId, userId],
      );
      if (own.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
      const doc = await asSystemInTx(client, async () => {
        const { invoiceId } = await issueOrderDocument(client, orderId);
        return loadTaxDocument(client, invoiceId);
      });
      await client.query('COMMIT');
      if (!doc) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

      const pdfBuf = await buildInvoicePdf(doc);
      const kind = documentTitle(doc).startsWith('DAŇOVÝ') ? 'danovy-doklad' : 'doklad';
      return new Response(new Uint8Array(pdfBuf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${kind}-${doc.number}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof TaxDocumentError) {
        return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
