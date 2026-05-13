/**
 * GET /promoters/:promoterId/invoices/:invoiceId/pdf
 *
 * Generate and download invoice PDF with QR payment code.
 */
import { getServices } from '../../../../../lib/service-container.js';
import { generateInvoicePdfBuffer, type PdfGenerationOptions } from '../../../../../services/invoice.service.js';

export async function GET(
  request: Request,
  { params }: { params: { promoterId: string; invoiceId: string } },
) {
  const { db } = getServices();
  const { promoterId, invoiceId } = params;

  // TODO: Load seller/buyer info from platform settings + promoter profile
  // For now, use placeholder — real implementation reads from DB
  const opts: PdfGenerationOptions = {
    locale: 'cs',
    seller: {
      name: 'Tixly s.r.o.',
      ico: '12345678',
      dic: 'CZ12345678',
      address: 'Náměstí Republiky 1\n110 00 Praha 1',
      bankAccount: 'CZ6508000000192000145399',
      iban: 'CZ6508000000192000145399',
    },
    buyer: {
      name: `Promotér ${promoterId.slice(0, 8)}`,
      address: '',
    },
    includeQrCode: true,
  };

  // Load promoter info if available
  try {
    const promoterRows = await db.query<Record<string, unknown>>(
      `SELECT name, legal_name, ico, dic, locale
       FROM platform.promoters
       WHERE id = $1`,
      [promoterId],
    );
    if (promoterRows.length > 0) {
      const p = promoterRows[0]!;
      opts.buyer.name = (p.legal_name as string) || (p.name as string);
      opts.buyer.ico = p.ico as string | undefined;
      opts.buyer.dic = p.dic as string | undefined;
      if (p.locale) opts.locale = p.locale as 'cs' | 'sk' | 'en' | 'de';
    }
  } catch {
    // Promoter info optional — continue with defaults
  }

  const pdfBuffer = await generateInvoicePdfBuffer(invoiceId, promoterId, opts, db);

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="invoice-${invoiceId.slice(0, 8)}.pdf"`,
      'Content-Length': String(pdfBuffer.length),
    },
  });
}
