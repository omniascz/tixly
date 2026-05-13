// Batch payout — agreguje všechny approved commissions (conversions) v období
// a vytvoří jediný payout row pro daného affiliata.
//
// Admin-initiated: voláno z admin API endpointu, ne samotným affiliatem.

import type { AffiliatePayout } from '../types/affiliate.types';

interface TxLike {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}
interface DbLike {
  transaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;
}

export interface PayoutBatchDeps {
  db: DbLike;
}

export interface PayoutBatchResult {
  payout: AffiliatePayout;
  conversionIds: string[];
  totalCommission: number;
}

/**
 * Vytvoří jeden payout batch pro affiliate ze všech approved (confirmed)
 * commissions spadajících do [fromDate, toDate]. Konverze označí jako 'paid_out'
 * přes payout_id, takže opakované volání je idempotentní vůči období.
 *
 * Vrací null pokud není co vyplatit.
 */
export async function createAffiliatePayoutBatch(
  affiliateId: string,
  fromDate: Date,
  toDate: Date,
  deps: PayoutBatchDeps,
): Promise<PayoutBatchResult | null> {
  return deps.db.transaction(async (tx) => {
    // Načti všechny confirmed konverze bez payout_id v období.
    const conversions = await tx.query<{ id: string; commission: number }>(
      `SELECT id, commission
         FROM affiliate.conversions
        WHERE affiliate_id = $1
          AND status = 'confirmed'
          AND payout_id IS NULL
          AND created_at >= $2
          AND created_at <= $3
        FOR UPDATE`,
      [affiliateId, fromDate, toDate],
    );

    if (conversions.length === 0) return null;

    const total = conversions.reduce((sum, c) => sum + c.commission, 0);
    if (total <= 0) return null;

    const [payout] = await tx.query<{ id: string; created_at: Date }>(
      `INSERT INTO affiliate.payouts (affiliate_id, amount, status, period_from, period_to)
       VALUES ($1, $2, 'pending', $3, $4)
       RETURNING id, created_at`,
      [affiliateId, total, fromDate, toDate],
    );

    const ids = conversions.map((c) => c.id);
    await tx.execute(
      `UPDATE affiliate.conversions
          SET payout_id = $1, status = 'paid_out'
        WHERE id = ANY($2::uuid[])`,
      [payout.id, ids],
    );

    // Odečti z wallet, pokud wallet používáš jako running total.
    await tx.execute(
      `UPDATE affiliate.affiliates
          SET wallet_balance = GREATEST(0, wallet_balance - $1)
        WHERE id = $2`,
      [total, affiliateId],
    );

    return {
      payout: {
        id: payout.id,
        affiliateId,
        amount: total,
        status: 'pending' as const,
        createdAt: payout.created_at,
      },
      conversionIds: ids,
      totalCommission: total,
    };
  });
}
