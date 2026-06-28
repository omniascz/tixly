/**
 * FanBonus engine — 2-3 % cashback po nákupu vstupenky.
 *
 * Po dokončení objednávky:
 *   1. Načte fan_bonus_enabled + fan_bonus_pct z catalog.events.
 *   2. Vydá platform-wide gift voucher (promoter_id=NULL → platí na všech akcích).
 *   3. Zaloguje do marketing.fan_bonus_issued (idempotent na order_id).
 *
 * Kupující dostane kód emailem a zadá ho při příštím nákupu jako voucherCode.
 * Checkout ho zpracuje přes existující gift_voucher flow.
 */

import type { PoolClient } from 'pg';
import { randomBytes } from 'crypto';

const EXPIRATION_MONTHS = 12;

function generateVoucherCode(): string {
  // Formát: FB-XXXX-XXXX (12 alfanumerických znaků)
  const hex = randomBytes(5).toString('hex').toUpperCase();
  return `FB-${hex.slice(0, 4)}-${hex.slice(4, 8)}${randomBytes(1).toString('hex').toUpperCase().slice(0, 1)}`;
}

export interface FanBonusResult {
  issued: true;
  voucherId: string;
  voucherCode: string;
  earnedHalire: number;
  bonusPct: number;
  expiresAt: string;
}
export interface FanBonusSkipped {
  issued: false;
  reason: 'disabled' | 'zero_amount' | 'already_issued' | 'not_found';
}

/**
 * Vydá FanBonus gift voucher po dokončení objednávky.
 * Idempotentní na order_id — druhé volání vrátí already_issued.
 */
export async function issueFanBonus(
  client: PoolClient,
  input: {
    orderId: string;
    eventId: string;
    userId: string | null;
    buyerEmail: string;
    orderTotalHalire: number;
  },
): Promise<FanBonusResult | FanBonusSkipped> {
  // Idempotency
  const existing = await client.query<{ voucher_id: string }>(
    `SELECT voucher_id FROM marketing.fan_bonus_issued WHERE order_id = $1`,
    [input.orderId],
  );
  if (existing.rows.length > 0) return { issued: false, reason: 'already_issued' };

  // Event settings
  const evR = await client.query<{
    fan_bonus_enabled: boolean;
    fan_bonus_pct: string;
  }>(
    `SELECT fan_bonus_enabled, fan_bonus_pct FROM catalog.events WHERE id = $1`,
    [input.eventId],
  );
  if (evR.rows.length === 0) return { issued: false, reason: 'not_found' };

  const { fan_bonus_enabled, fan_bonus_pct } = evR.rows[0];
  if (!fan_bonus_enabled) return { issued: false, reason: 'disabled' };

  const pct = parseFloat(fan_bonus_pct);
  const earnedHalire = Math.round(input.orderTotalHalire * pct / 100);
  if (earnedHalire <= 0) return { issued: false, reason: 'zero_amount' };

  const code = generateVoucherCode();
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + EXPIRATION_MONTHS);

  // Vydej gift voucher (promoter_id=NULL → platform-wide, event_id=NULL → neomezeno na akci)
  const vR = await client.query<{ id: string }>(
    `INSERT INTO marketing.gift_vouchers
       (code, promoter_id, event_id, amount_halire, balance_halire,
        currency, issued_to_email, expires_at)
     VALUES ($1, NULL, NULL, $2, $2, 'CZK', $3, $4)
     RETURNING id`,
    [code, earnedHalire, input.buyerEmail, expiresAt.toISOString()],
  );
  const voucherId = vR.rows[0].id;

  // Zaloguj
  await client.query(
    `INSERT INTO marketing.fan_bonus_issued
       (order_id, voucher_id, event_id, user_id, earned_halire, bonus_pct)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.orderId, voucherId, input.eventId, input.userId, earnedHalire, pct],
  );

  return {
    issued: true,
    voucherId,
    voucherCode: code,
    earnedHalire,
    bonusPct: pct,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Vrátí přehled FanBonus voucherů daného uživatele.
 */
export async function getFanBonusHistory(
  client: PoolClient,
  userId: string,
): Promise<Array<{
  orderId: string;
  eventId: string;
  earnedHalire: number;
  bonusPct: number;
  voucherCode: string;
  balanceHalire: number;
  expiresAt: string;
  createdAt: string;
}>> {
  const r = await client.query<{
    order_id: string;
    event_id: string;
    earned_halire: number;
    bonus_pct: string;
    code: string;
    balance_halire: number;
    expires_at: string;
    created_at: string;
  }>(
    `SELECT
       fbi.order_id,
       fbi.event_id,
       fbi.earned_halire,
       fbi.bonus_pct,
       gv.code,
       gv.balance_halire,
       gv.expires_at::text,
       fbi.created_at::text
     FROM marketing.fan_bonus_issued fbi
     JOIN marketing.gift_vouchers gv ON gv.id = fbi.voucher_id
     WHERE fbi.user_id = $1
     ORDER BY fbi.created_at DESC
     LIMIT 50`,
    [userId],
  );

  return r.rows.map((row) => ({
    orderId: row.order_id,
    eventId: row.event_id,
    earnedHalire: row.earned_halire,
    bonusPct: parseFloat(row.bonus_pct),
    voucherCode: row.code,
    balanceHalire: row.balance_halire,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}
