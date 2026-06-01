/**
 * GET /api/v3/secure-entry/barcode?token=<se_...>
 *
 * Secure Entry SDK barcode endpoint. SDK volá á 30s pro fresh TOTP code.
 * Token = short-lived (5min), SDK refreshne při 80 % TTL.
 *
 * Žádný auth header — token v query je auth.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { decryptSecret } from '@/lib/crypto';
import { generateTotpCode } from '@/lib/totp/verify';
import { verifySecureEntryToken } from '@/lib/secure-entry/sdk';


const STEP_SECONDS = 30;

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token_required' }, { status: 400 });

  const verified = await verifySecureEntryToken(token);
  if (!verified) return NextResponse.json({ error: 'invalid_or_expired_token' }, { status: 401 });

  // Load ticket TOTP secret
  const t = await db().query<{
    id: string;
    totp_secret_encrypted: Buffer;
    status: string;
  }>(
    `SELECT id, totp_secret_encrypted, status FROM tickets.tickets WHERE id = $1`,
    [verified.ticketId],
  );
  if (t.rows.length === 0) return NextResponse.json({ error: 'ticket_not_found' }, { status: 404 });
  if (t.rows[0].status !== 'valid') return NextResponse.json({ error: 'ticket_not_valid' }, { status: 410 });

  const secretB64 = decryptSecret(t.rows[0].totp_secret_encrypted.toString('base64'));
  const secretRaw = Buffer.from(secretB64, 'base64');

  const nowMs = Date.now();
  const code = generateTotpCode(secretRaw, new Date(nowMs));
  const expiresInSec = STEP_SECONDS - Math.floor((nowMs / 1000) % STEP_SECONDS);

  return NextResponse.json({
    barcode: {
      payload: `tixly:${verified.ticketId}:${code}`,
      code,
      expires_in_sec: expiresInSec,
      next_refresh_sec: expiresInSec + 1,
    },
    ticket_id: verified.ticketId,
  });

  });
}
