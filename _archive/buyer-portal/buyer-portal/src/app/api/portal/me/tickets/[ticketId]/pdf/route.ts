import { NextRequest, NextResponse } from 'next/server';
import { getServiceDeps } from '../../../../../../../lib/service-container.js';
import {
  BuyerPortalError,
  isBuyerPortalError,
} from '../../../../../../../lib/buyer-portal-errors.js';
import { getBuyerTicketDetail } from '../../../../../../../services/buyer-portal.service.js';

export async function GET(
  req: NextRequest,
  ctx: { params: { ticketId: string } },
): Promise<NextResponse> {
  try {
    const userId = req.headers.get('x-user-id');
    if (!userId) {
      throw new BuyerPortalError('UNAUTHORIZED');
    }

    const deps = getServiceDeps();
    const { ticketId } = ctx.params;

    // 1. Ownership check — ručně přes service. Pokud uživatel není vlastník,
    //    service vyhodí TICKET_NOT_FOUND (anti-enumerace).
    const detail = await getBuyerTicketDetail(ticketId, userId, deps);

    // 2. Generování PDF přes @tixly/pdf-ticket workspace modul.
    // Dynamický import, protože pdf-lib/bwip-js jsou těžké a chceme je načítat
    // lazy jen při skutečném požadavku na PDF. Pokud import selže, logujeme
    // skutečnou chybu (ne catch-silence) a vracíme INTERNAL_ERROR.
    let pdfMod: typeof import('@tixly/pdf-ticket/src/services/pdf-ticket.service.js');
    let cryptoMod: typeof import('@tixly/crypto');
    try {
      [pdfMod, cryptoMod] = await Promise.all([
        import('@tixly/pdf-ticket/src/services/pdf-ticket.service.js'),
        import('@tixly/crypto'),
      ]);
    } catch (importErr) {
      console.error('[pdf/route] Failed to load @tixly/pdf-ticket or @tixly/crypto:', importErr);
      throw new BuyerPortalError(
        'INTERNAL_ERROR',
        'PDF modul nebo crypto modul není dostupný.',
      );
    }

    const service = new (pdfMod as any).PdfTicketService();
    const result = await service.generateForTicket(
      ticketId,
      userId,
      'cs',
      (deps as any).db,
      cryptoMod,
    );

    const buffer: Buffer = result.pdfBuffer ?? result.buffer ?? result;

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="vstupenka-${detail.shortCode}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    if (isBuyerPortalError(err)) {
      return NextResponse.json(err.toHttpError(), { status: err.statusCode });
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: 'Internal server error' },
      { status: 500 },
    );
  }
}
