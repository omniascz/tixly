/**
 * Purchase-limit enforcement — "1 person = 1 limit" per event.
 *
 * Uses the GDPR-compliant identity hash (see identity-crypto.hashIdentity) as
 * the dedup key, so the same verified person cannot bypass a per-event ticket
 * limit by creating multiple platform accounts.
 *
 * Required migration (table):
 *
 *   CREATE TABLE identity.identity_purchases (
 *     id             BIGSERIAL PRIMARY KEY,
 *     identity_hash  CHAR(64)    NOT NULL,
 *     event_id       UUID        NOT NULL,
 *     ticket_count   INTEGER     NOT NULL CHECK (ticket_count > 0),
 *     purchased_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 *   CREATE INDEX identity_purchases_hash_event_idx
 *     ON identity.identity_purchases (identity_hash, event_id);
 */

export interface PurchaseLimitDeps {
  db: {
    query<T>(sql: string, params?: unknown[]): Promise<T[]>;
    execute(sql: string, params?: unknown[]): Promise<void>;
  };
}

export interface LimitCheckResult {
  reached: boolean;
  currentCount: number;
}

/**
 * Returns whether the given verified identity has already bought >= `limit`
 * tickets for the given event.
 */
export async function hasReachedPurchaseLimit(
  identityHash: string,
  eventId: string,
  limit: number,
  deps: PurchaseLimitDeps,
): Promise<LimitCheckResult> {
  if (!identityHash) throw new Error('hasReachedPurchaseLimit: identityHash required');
  if (!eventId)      throw new Error('hasReachedPurchaseLimit: eventId required');
  if (limit <= 0)    throw new Error('hasReachedPurchaseLimit: limit must be > 0');

  const rows = await deps.db.query<{ total: string | number | null }>(
    `SELECT COALESCE(SUM(ticket_count), 0) AS total
       FROM identity.identity_purchases
      WHERE identity_hash = $1
        AND event_id      = $2`,
    [identityHash, eventId],
  );

  const currentCount = Number(rows[0]?.total ?? 0);
  return { reached: currentCount >= limit, currentCount };
}

/**
 * Records a successful purchase against the identity hash + event.
 * Call this ONLY after payment has been confirmed.
 */
export async function recordPurchase(
  identityHash: string,
  eventId: string,
  ticketCount: number,
  deps: PurchaseLimitDeps,
): Promise<void> {
  if (!identityHash)    throw new Error('recordPurchase: identityHash required');
  if (!eventId)         throw new Error('recordPurchase: eventId required');
  if (ticketCount <= 0) throw new Error('recordPurchase: ticketCount must be > 0');

  await deps.db.execute(
    `INSERT INTO identity.identity_purchases (identity_hash, event_id, ticket_count)
     VALUES ($1, $2, $3)`,
    [identityHash, eventId, ticketCount],
  );
}
