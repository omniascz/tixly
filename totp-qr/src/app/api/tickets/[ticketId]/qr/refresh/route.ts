import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// POST /api/tickets/{ticketId}/qr/refresh
// Called by the frontend every 30 seconds to rotate the QR code.
// Returns a fresh TOTP-based QR payload with the next time-window code.
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  context: { params: { ticketId: string } },
): Promise<NextResponse> {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { ticketId } = await context.params;

  try {
    const { TicketQRService } = await import('../../../../../../services/ticket-qr.service.js');
    const { db, redis } = await import('../../../../../../lib/service-container.js' as any);

    const service = new TicketQRService(db, redis);
    const userId = extractUserId(token);

    const encoded = await service.refreshQR(ticketId, userId);

    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSeconds = 30 - (nowSec % 30);

    return NextResponse.json(
      {
        ticketId,
        qrPayload: encoded,
        expiresInSeconds: ttlSeconds,
        refreshAfterSeconds: ttlSeconds,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('TICKET_NOT_FOUND')) {
      return NextResponse.json({ error: 'TICKET_NOT_FOUND' }, { status: 404 });
    }
    if (msg.startsWith('TICKET_OWNERSHIP_DENIED')) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    if (msg.startsWith('TICKET_REVOKED')) {
      return NextResponse.json({ error: 'TICKET_REVOKED' }, { status: 409 });
    }
    console.error('[ticket-qr/refresh]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

function extractUserId(token: string): string {
  try {
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64 ?? '', 'base64url').toString('utf8'));
    return String(payload.sub ?? payload.userId ?? '');
  } catch {
    return '';
  }
}
