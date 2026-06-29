import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export interface DistributionContext {
  partnerId: string;
  scopes: string[];
}

export async function verifyDistributionToken(req: NextRequest): Promise<DistributionContext | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.toLowerCase().startsWith('bearer ')) return null;
  const rawToken = auth.slice(7).trim();
  if (!rawToken) return null;

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');

  const r = await db().query<{ partner_id: string; scopes: string[] }>(
    `SELECT dat.partner_id, dp.scopes
     FROM platform.distribution_access_tokens dat
     JOIN platform.distribution_partners dp ON dp.id = dat.partner_id
     WHERE dat.token_hash = $1
       AND dat.expires_at > NOW()
       AND dp.active = true`,
    [tokenHash],
  );
  if (r.rows.length === 0) return null;

  await db().query(
    `UPDATE platform.distribution_partners SET last_used_at = NOW() WHERE id = $1`,
    [r.rows[0].partner_id],
  );

  return { partnerId: r.rows[0].partner_id, scopes: r.rows[0].scopes };
}
