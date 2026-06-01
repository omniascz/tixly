/**
 * Partner API token authentication.
 *
 * Format: `tixly_partner_<32 hex chars>` (40 chars total).
 * Storage: SHA-256 hash v DB, raw token vrácen jen jednou při vytvoření.
 * Header: `Authorization: Bearer tixly_partner_xxx`
 */

import { createHash, randomBytes } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import type { NextRequest } from 'next/server';


const TOKEN_PREFIX = 'tixly_partner_';

export function generatePartnerToken(): { token: string; hash: string } {
  const raw = randomBytes(16).toString('hex'); // 32 hex chars
  const token = `${TOKEN_PREFIX}${raw}`;
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PartnerContext {
  partnerId: string;
  partnerName: string;
  tokenId: string;
  commissionPct: number;
  status: string;
}

export async function requirePartner(req: NextRequest): Promise<PartnerContext | null> {
  const auth = req.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(tixly_partner_[a-f0-9]{32})$/i);
  if (!match) return null;
  const token = match[1];
  const hash = hashToken(token);

  // Bootstrap: validace partner tokenu PŘED kontextem → service kontext.
  const r = await runWithServiceContext(() =>
    db().query<{
      partner_id: string;
      token_id: string;
      partner_name: string;
      commission_pct: number;
      status: string;
    }>(
      `SELECT p.id AS partner_id, t.id AS token_id, p.name AS partner_name,
              p.commission_pct, p.status
       FROM partner.partner_tokens t
       JOIN partner.partners p ON p.id = t.partner_id
       WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [hash],
    ),
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];

  // Update last_used_at fire-and-forget (service kontext)
  void runWithServiceContext(() =>
    db().query(`UPDATE partner.partner_tokens SET last_used_at = NOW() WHERE id = $1`, [row.token_id]),
  ).catch(() => undefined);

  return {
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    tokenId: row.token_id,
    commissionPct: Number(row.commission_pct),
    status: row.status,
  };
}
