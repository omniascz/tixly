import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// GET /api/tickets/{ticketId}/qr
// Generate rotating QR code for a ticket (SafeTix-like, TOTP-based).
// QR payload changes every 30 seconds — screenshot fraud eliminated.
// Requires: Authorization: Bearer <session-token>
// ---------------------------------------------------------------------------

export async function GET(
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
    // In production: decode JWT to get userId, then inject real DB+Redis adapters
    // Here we surface the contract — actual wiring done in service container
    const { TicketQRService } = await import('../../../../../services/ticket-qr.service.js');
    const { db, redis } = await import('../../../../../lib/service-container.js' as any);

    const service = new TicketQRService(db, redis);
    const userId = extractUserId(token);

    const encoded = await service.generateQR(ticketId, userId);

    // Compute TTL until next 30-second window
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
        headers: {
          'Cache-Control': `no-store`,
        },
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
    console.error('[ticket-qr]', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

/** Extract userId from a Bearer token (JWT payload.sub). */
function extractUserId(token: string): string {
  try {
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64 ?? '', 'base64url').toString('utf8'));
    return String(payload.sub ?? payload.userId ?? '');
  } catch {
    return '';
  }
}
