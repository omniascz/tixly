/**
 * Eventim-style re-issue flow.
 *
 * Když se resale listing prodá:
 *   1. Originál tickets.tickets.status = 'revoked' (anti-counterfeit)
 *   2. Mint NOVOU tickets.tickets s:
 *      - NEW totp_secret_encrypted (jiný TOTP secret, jiný QR)
 *      - reissue_parent_id = original.id
 *      - reissue_count = parent.reissue_count + 1
 *      - owner_id = buyer
 *      - status = 'valid'
 *      - device_binding_id = NULL (fresh)
 *      - bound_phone_e164 = NULL (fresh)
 *   3. Audit log
 *   4. Enqueue seller payout (now + delay_days)
 *
 * Volat z resale/buy route uvnitř TX.
 */
import crypto from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { encryptSecret } from '@/lib/crypto';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface ReissueInput {
  client: PoolClient;
  originalTicketId: string;
  newOwnerId: string;
  newOrderId: string;
  reason?: string;
}

export interface ReissueResult {
  newTicketId: string;
  newTotpSecretLength: number;
}

/**
 * Re-issue ticket. Volat UVNITŘ existující transaction (client je passed in).
 */
export async function reissueTicket(input: ReissueInput): Promise<ReissueResult> {
  const original = await input.client.query<{
    id: string;
    ticket_type_id: string;
    order_id: string;
    original_price: number;
    event_seat_id: string | null;
    reissue_count: number;
    status: string;
  }>(
    `SELECT id, ticket_type_id, order_id, original_price, event_seat_id,
            reissue_count, status
       FROM tickets.tickets
      WHERE id = $1
      FOR UPDATE`,
    [input.originalTicketId],
  );

  if (original.rows.length === 0) {
    throw new Error('ORIGINAL_TICKET_NOT_FOUND');
  }
  const orig = original.rows[0];
  if (orig.status !== 'valid') {
    throw new Error(`ORIGINAL_NOT_VALID_${orig.status}`);
  }

  // 1. Revoke original
  await input.client.query(
    `UPDATE tickets.tickets
        SET status = 'revoked', updated_at = now()
      WHERE id = $1`,
    [input.originalTicketId],
  );

  // 2. Generate new TOTP secret (32 bytes random → encrypted at rest)
  const newSecretRaw = crypto.randomBytes(32);
  const newSecretEncrypted = encryptSecret(newSecretRaw.toString('base64'));
  const newSecretBuffer = Buffer.from(newSecretEncrypted, 'base64');

  // 3. Mint new ticket with same seat (if any) + new TOTP + parent link
  const newTicketRes = await input.client.query<{ id: string }>(
    `INSERT INTO tickets.tickets
       (ticket_type_id, order_id, owner_id, status, original_price,
        totp_secret_encrypted, event_seat_id,
        reissue_parent_id, reissue_count, reissue_reason,
        transfer_count, created_at, updated_at)
     VALUES ($1, $2, $3, 'valid', $4, $5, $6, $7, $8, $9, 0, now(), now())
     RETURNING id`,
    [
      orig.ticket_type_id,
      input.newOrderId,
      input.newOwnerId,
      orig.original_price,
      newSecretBuffer,
      orig.event_seat_id,
      input.originalTicketId,
      orig.reissue_count + 1,
      input.reason ?? 'resale_sale',
    ],
  );

  const newTicketId = newTicketRes.rows[0].id;

  // 4. Audit log
  await input.client.query(
    `INSERT INTO audit.audit_log
       (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
     VALUES ('tickets', 'tickets', $1, 'INSERT', $2, 'system', $3::jsonb)`,
    [
      newTicketId, input.newOwnerId,
      JSON.stringify({
        reissue_from: input.originalTicketId,
        reissue_count: orig.reissue_count + 1,
        reason: input.reason ?? 'resale_sale',
      }),
    ],
  );

  return {
    newTicketId,
    newTotpSecretLength: newSecretRaw.length,
  };
}

/**
 * Enqueue seller payout. Volat po reissue v same TX.
 */
export async function enqueueSellerPayout(input: {
  client: PoolClient;
  listingId: string;
  sellerId: string;
  salePriceHalire: number;
  eventId: string;
  currency?: string;
}): Promise<{ payoutId: string; scheduledFor: Date }> {
  // Load event fee policy
  const eventRes = await input.client.query<{
    resale_fee_pct: number;
    payout_delay_days: number;
  }>(
    `SELECT resale_fee_pct, resale_seller_payout_delay_days AS payout_delay_days
       FROM catalog.events WHERE id = $1`,
    [input.eventId],
  );
  const policy = eventRes.rows[0] ?? { resale_fee_pct: 5, payout_delay_days: 4 };

  const feeHalire = Math.round((input.salePriceHalire * Number(policy.resale_fee_pct)) / 100);
  const payoutHalire = input.salePriceHalire - feeHalire;

  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + Number(policy.payout_delay_days));

  // Load seller's IBAN (if set on user profile — may not exist yet)
  const sellerBank = await input.client.query<{
    bank_iban: string | null;
    bank_account_holder: string | null;
  }>(
    `SELECT
       (SELECT iban FROM identity.user_bank_accounts
         WHERE user_id = $1 AND is_default = true LIMIT 1) AS bank_iban,
       (SELECT account_holder_name FROM identity.user_bank_accounts
         WHERE user_id = $1 AND is_default = true LIMIT 1) AS bank_account_holder`,
    [input.sellerId],
  ).catch(() => ({ rows: [{ bank_iban: null, bank_account_holder: null }] }));

  const r = await input.client.query<{ id: string }>(
    `INSERT INTO resale.seller_payouts
       (listing_id, seller_id, sale_price_halire, resale_fee_halire,
        payout_halire, currency, bank_iban, bank_account_holder, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
     RETURNING id`,
    [
      input.listingId, input.sellerId, input.salePriceHalire,
      feeHalire, payoutHalire, input.currency ?? 'CZK',
      sellerBank.rows[0]?.bank_iban ?? null,
      sellerBank.rows[0]?.bank_account_holder ?? null,
      scheduledFor.toISOString(),
    ],
  );

  return { payoutId: r.rows[0].id, scheduledFor };
}

/**
 * Check resale eligibility before allowing listing.
 */
export async function checkResaleEligibility(ticketId: string): Promise<{
  eligible: boolean;
  reason: string;
  resaleDeadline?: string;
}> {
  const r = await db().query<{
    is_eligible: boolean;
    eligibility_reason: string;
    resale_deadline: string;
  }>(
    `SELECT is_eligible, eligibility_reason, resale_deadline::text
       FROM resale.vw_ticket_resale_eligibility
      WHERE ticket_id = $1`,
    [ticketId],
  );
  if (r.rows.length === 0) {
    return { eligible: false, reason: 'ticket_not_found' };
  }
  return {
    eligible: r.rows[0].is_eligible,
    reason: r.rows[0].eligibility_reason,
    resaleDeadline: r.rows[0].resale_deadline,
  };
}
