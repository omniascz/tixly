/** Odpověď s dokladem ve zvoleném formátu (PDF nebo ISDOC) — kolo 7, C-54. */
import { NextResponse } from 'next/server';
import { buildInvoicePdf } from './invoice-pdf';
import { buildIsdocXml } from './isdoc';
import type { TaxDocument } from './tax-document';

export async function taxDocumentResponse(doc: TaxDocument, format: string | null): Promise<Response> {
  if (format === 'isdoc') {
    return new Response(buildIsdocXml(doc), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="doklad-${doc.number}.isdoc"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  if (format && format !== 'pdf') {
    return NextResponse.json({ error: 'BAD_FORMAT', message: 'format=pdf nebo isdoc' }, { status: 422 });
  }
  const pdf = await buildInvoicePdf(doc);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="doklad-${doc.number}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
