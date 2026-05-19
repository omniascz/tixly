/**
 * GET /api/buyer/cross-passes/[membershipId]/code
 *
 * Vrací aktuální TOTP code (RFC 6238) pro cross-pass membership.
 * Auth: x-user-id musí být vlastník membership.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { decryptSecret } from '@/lib/crypto';
import { generateTotpCode } from '@/lib/totp/verify';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  ctx: { params: { membershipId: string } },
): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const r = await db().query<{
    id: string;
    status: string;
    bundle_name: string;
    bundle_id: string;
    totp_secret_encrypted: Buffer;
    starts_at: string | null;
    ends_at: string | null;
  }>(
    `SELECT m.id, m.status, m.bundle_id, m.totp_secret_encrypted,
            b.name AS bundle_name, b.starts_at, b.ends_at
     FROM tickets.cross_pass_memberships m
     JOIN catalog.cross_pass_bundles b ON b.id = m.bundle_id
     WHERE m.id = $1 AND m.user_id = $2`,
    [ctx.params.membershipId, userId],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const row = r.rows[0];
  if (row.status !== 'active') {
    return NextResponse.json({ error: 'INACTIVE', status: row.status }, { status: 409 });
  }

  const secretB64 = decryptSecret(row.totp_secret_encrypted.toString('base64'));
  const secretRaw = Buffer.from(secretB64, 'base64');
  const code = generateTotpCode(secretRaw);
  const epochSec = Math.floor(Date.now() / 1000);
  const periodSec = 30;
  const expiresInSec = periodSec - (epochSec % periodSec);

  return NextResponse.json({
    membershipId: row.id,
    bundleId: row.bundle_id,
    bundleName: row.bundle_name,
    code,
    expiresInSec,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  });
}
