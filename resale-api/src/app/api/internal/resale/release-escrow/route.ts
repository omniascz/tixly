/**
 * Feature #47 — Internal endpoint: POST /api/internal/resale/release-escrow
 *
 * Voláno z gate-scanner modulu (sms-barcode) PO úspěšné TOTP validaci.
 * Idempotentní — opakované volání pro stejnou vstupenku je no-op.
 *
 * Autentizace: shared secret v hlavičce `x-internal-auth`. NENÍ určeno
 * pro veřejnou expozici — Kong / API gateway musí cestu `/api/internal/*`
 * blokovat z venku a propouštět pouze interní service-to-service trafik.
 *
 * Body:   { ticketId: string }
 * 200:    { released: boolean, payoutAmount: number | null, listingId: string | null }
 * 400:    chybný body / chybí ticketId
 * 401:    chybný / chybějící x-internal-auth
 * 500:    nečekaná chyba (logováno)
 */

import { NextRequest, NextResponse } from 'next/server';
import { releaseEscrowOnEntry } from '../../../../../lib/escrow-release.js';
import { getServiceContainer } from '../../../../../lib/service-container.js';

interface ReleaseEscrowBody {
  ticketId?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth — musí přijít platný internal token. Nikdy nesmí být undefined
  //    na obou stranách (timing-safe by bylo lepší, ale shared secret stačí
  //    pro internal-only routu).
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  const provided = request.headers.get('x-internal-auth');

  if (!expected || !provided || provided !== expected) {
    return NextResponse.json(
      { error: 'Neautorizovaný požadavek', code: 'INTERNAL_AUTH_FAILED' },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: ReleaseEscrowBody;
  try {
    body = (await request.json()) as ReleaseEscrowBody;
  } catch {
    return NextResponse.json(
      { error: 'Nevalidní JSON v těle požadavku', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  if (typeof body.ticketId !== 'string' || body.ticketId.length === 0) {
    return NextResponse.json(
      { error: "Pole 'ticketId' je povinné", code: 'MISSING_TICKET_ID' },
      { status: 400 },
    );
  }

  // 3. Volání service vrstvy
  try {
    const { db, eventBus, gopay } = getServiceContainer();
    const result = await releaseEscrowOnEntry(body.ticketId, { db, eventBus, gopay });

    return NextResponse.json(
      {
        released: result.released,
        payoutAmount: result.payoutAmount,
        listingId: result.listingId,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[internal/release-escrow] releaseEscrowOnEntry threw:', err);
    return NextResponse.json(
      { error: 'Interní chyba serveru', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
