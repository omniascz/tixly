import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';

const bodySchema = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
});

export async function POST(req: NextRequest): Promise<Response> {
  // Kolo 2 / 3B: výdej tokenu partnerovi (ověření client_secret uvnitř); distribution_* pod RLS jen svc/admin
  return runWithServiceContext(async () => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { client_id, client_secret } = parsed.data;

  const r = await db().query<{ id: string; client_secret_hash: string; active: boolean }>(
    `SELECT id, client_secret_hash, active FROM platform.distribution_partners WHERE client_id = $1`,
    [client_id],
  );

  const partner = r.rows[0];
  if (!partner || !partner.active) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const valid = await bcrypt.compare(client_secret, partner.client_secret_hash);
  if (!valid) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  await db().query(
    `INSERT INTO platform.distribution_access_tokens (partner_id, token_hash)
     VALUES ($1, $2)`,
    [partner.id, tokenHash],
  );

  await db().query(
    `DELETE FROM platform.distribution_access_tokens
     WHERE partner_id = $1 AND expires_at < NOW()`,
    [partner.id],
  );

  return NextResponse.json({
    access_token: rawToken,
    token_type: 'Bearer',
    expires_in: 3600,
  });
  });
}
