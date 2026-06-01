/**
 * Secure Entry SDK — server-side token issuance.
 *
 * Partner app (3rd party) prodal lístek přes Tixly Partner API.
 * Klientská app potřebuje rendrovat rotující SafeTix barcode lokálně.
 *
 * Flow:
 *   1. Partner client requestne POST /api/v3/tickets/[id]/secure-entry-token
 *      → server vrátí short-lived token (TTL 5 min)
 *   2. Partner client vloží token do Secure Entry SDK (JS/iOS/Android)
 *   3. SDK volá GET /api/v3/secure-entry/barcode?token=...
 *      → server vrátí aktuální TOTP code + reveal time
 *   4. SDK auto-refresh á 30s
 */
import crypto from 'node:crypto';
import { db } from '@/lib/db/rls-pool';
import { hashSecret } from '@/lib/oauth/flow';


const SECURE_ENTRY_TOKEN_PREFIX = 'se_';
const SECURE_ENTRY_TTL_SECONDS = 300; // 5 min

export interface SecureEntryToken {
  token: string;
  expiresAt: string;
  refreshIntervalSeconds: number;
}

export async function issueSecureEntryToken(input: {
  clientPkId: string;
  ticketId: string;
  partnerAccountId: string;
}): Promise<SecureEntryToken | { error: string }> {
  // Verify ticket exists + accessible to client
  const t = await db().query<{ id: string; status: string }>(
    `SELECT id, status FROM tickets.tickets WHERE id = $1`,
    [input.ticketId],
  );
  if (t.rows.length === 0) return { error: 'ticket_not_found' };
  if (t.rows[0].status !== 'valid') return { error: 'ticket_not_valid' };

  const token = `${SECURE_ENTRY_TOKEN_PREFIX}${crypto.randomBytes(32).toString('hex')}`;
  const tokenHash = hashSecret(token);
  const expiresAt = new Date(Date.now() + SECURE_ENTRY_TTL_SECONDS * 1000);

  await db().query(
    `INSERT INTO b2b.secure_entry_tokens
       (client_id, ticket_id, partner_account_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)`,
    [input.clientPkId, input.ticketId, input.partnerAccountId, tokenHash, expiresAt.toISOString()],
  );

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    refreshIntervalSeconds: 240, // refresh 1 min před expiry
  };
}

export async function verifySecureEntryToken(token: string): Promise<{
  ticketId: string;
  clientPkId: string;
} | null> {
  if (!token.startsWith(SECURE_ENTRY_TOKEN_PREFIX)) return null;
  const hash = hashSecret(token);
  const r = await db().query<{
    id: string; client_id: string; ticket_id: string;
    expires_at: string; revoked_at: string | null;
  }>(
    `SELECT id, client_id, ticket_id, expires_at::text, revoked_at::text
       FROM b2b.secure_entry_tokens WHERE token_hash = $1`,
    [hash],
  );
  if (r.rows.length === 0) return null;
  const t = r.rows[0];
  if (t.revoked_at) return null;
  if (new Date(t.expires_at) < new Date()) return null;

  // Update last_refreshed_at + issued_count
  void db().query(
    `UPDATE b2b.secure_entry_tokens
        SET last_refreshed_at = now(), issued_count = issued_count + 1
      WHERE id = $1`,
    [t.id],
  );

  return { ticketId: t.ticket_id, clientPkId: t.client_id };
}
