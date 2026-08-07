/**
 * Unified payout executor.
 *
 * Picks the right payout provider for each pending payout record and executes it.
 * Called by the payouts-execute cron job.
 *
 * Provider selection:
 *   1. Explicit payout_method on promoter (sepa_credit | wise → Wise; paypal → PayPal)
 *   2. Currency-based auto-routing:
 *      - EUR/GBP/PLN/non-CZK → Wise (covers SEPA + SWIFT)
 *      - CZK → FIO (existing CZ bank transfer)
 *   3. If no IBAN and no PayPal email → log and skip (operator must fix promoter data)
 *
 * Failure handling:
 *   - On API error: status = 'failed', failure_reason set, retry_count incremented
 *   - After 3 failures: status stays 'failed' (manual review required)
 *   - On success: status = 'paid', external_payout_id = provider ID, executed_at = NOW()
 */

import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  getWiseConfig,
  createWiseRecipient,
  getWiseRecipient,
  createAndFundWiseTransfer,
} from './wise';
import { createPayPalPayout } from './paypal-payouts';

const MAX_RETRIES = 3;

interface PromoterPayoutRow {
  payout_id: string;
  promoter_id: string;
  net_payout: number;
  currency: string;
  retry_count: number;
  // Promoter data
  promoter_name: string;
  iban: string | null;
  swift_bic: string | null;
  payout_method: string | null;
  payout_currency: string | null;
  wise_recipient_id: number | null;
  paypal_payout_email: string | null;
}

type ExecuteResult = {
  payoutId: string;
  status: 'paid' | 'skipped' | 'failed';
  provider?: string;
  externalId?: string;
  reason?: string;
};

/**
 * Execute a single pending payout.
 * Updates platform.payouts status in DB.
 */
async function executePayoutImpl(row: PromoterPayoutRow): Promise<ExecuteResult> {
  const amountMajor = row.net_payout / 100;

  // Determine provider
  const method = row.payout_method;
  const currency = row.payout_currency ?? row.currency;
  const isEurLike = currency !== 'CZK';

  // PayPal path
  if (method === 'paypal' && row.paypal_payout_email) {
    return executePayPalPayout(row, amountMajor, currency);
  }

  // Wise path: explicit wise/sepa_credit OR non-CZK currency with IBAN
  if ((method === 'wise' || method === 'sepa_credit' || isEurLike) && row.iban) {
    return executeWisePayout(row, amountMajor, currency);
  }

  // CZK domestic: FIO Bank (mock — FIO integration exists but is manual)
  if (currency === 'CZK' && row.iban) {
    return executeFioPayout(row, amountMajor);
  }

  // Cannot execute — missing payout details
  const reason = !row.iban && !row.paypal_payout_email
    ? 'Promoter has no IBAN or PayPal payout email configured'
    : `No suitable provider for currency=${currency} method=${method ?? 'unset'}`;

  await db().query(
    `UPDATE platform.payouts
     SET status = 'failed', failure_reason = $2
     WHERE id = $1`,
    [row.payout_id, reason],
  );

  return { payoutId: row.payout_id, status: 'skipped', reason };
}

// ─── Wise ─────────────────────────────────────────────────────────────

async function executeWisePayout(
  row: PromoterPayoutRow,
  amountMajor: number,
  targetCurrency: string,
): Promise<ExecuteResult> {
  const wiseCfg = getWiseConfig();
  if (!wiseCfg.isConfigured) {
    const reason = 'Wise not configured (WISE_API_KEY missing)';
    await failPayout(row.payout_id, reason, row.retry_count);
    return { payoutId: row.payout_id, status: 'failed', reason };
  }

  try {
    // Ensure recipient exists (use cached ID or create new)
    let recipientId = row.wise_recipient_id;

    if (!recipientId) {
      const recipient = await createWiseRecipient({
        accountHolderName: row.promoter_name,
        currency: targetCurrency,
        iban: row.iban!,
        bic: row.swift_bic ?? undefined,
        legalType: 'BUSINESS',
      });
      recipientId = recipient.id;

      // Cache wise_recipient_id on promoter
      await db().query(
        `UPDATE platform.promoters SET wise_recipient_id = $2 WHERE id = $1`,
        [row.promoter_id, recipientId],
      );
    } else {
      // Verify cached recipient is still valid
      try {
        await getWiseRecipient(recipientId);
      } catch {
        // Stale — recreate
        const newRecipient = await createWiseRecipient({
          accountHolderName: row.promoter_name,
          currency: targetCurrency,
          iban: row.iban!,
          bic: row.swift_bic ?? undefined,
          legalType: 'BUSINESS',
        });
        recipientId = newRecipient.id;
        await db().query(
          `UPDATE platform.promoters SET wise_recipient_id = $2 WHERE id = $1`,
          [row.promoter_id, recipientId],
        );
      }
    }

    const sourceCurrency = process.env.WISE_SOURCE_CURRENCY ?? 'EUR';

    const { transfer, fundStatus } = await createAndFundWiseTransfer({
      recipientId,
      sourceCurrency,
      targetCurrency,
      targetAmountMajorUnits: amountMajor,
      reference: `Tixly výplata #${row.payout_id.slice(0, 8)}`,
      idempotencyKey: row.payout_id,
    });

    await db().query(
      `UPDATE platform.payouts
       SET status = 'processing', payout_provider = 'wise',
           external_payout_id = $2, executed_at = NOW(),
           failure_reason = NULL
       WHERE id = $1`,
      [row.payout_id, String(transfer.id)],
    );

    return {
      payoutId: row.payout_id,
      status: 'paid',
      provider: 'wise',
      externalId: String(transfer.id),
      reason: `fundStatus=${fundStatus}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failPayout(row.payout_id, reason, row.retry_count);
    return { payoutId: row.payout_id, status: 'failed', provider: 'wise', reason };
  }
}

// ─── PayPal Payouts ───────────────────────────────────────────────────

async function executePayPalPayout(
  row: PromoterPayoutRow,
  amountMajor: number,
  currency: string,
): Promise<ExecuteResult> {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    const reason = 'PayPal not configured';
    await failPayout(row.payout_id, reason, row.retry_count);
    return { payoutId: row.payout_id, status: 'failed', reason };
  }

  try {
    const result = await createPayPalPayout({
      senderBatchId: `tixly-${row.payout_id}`,
      emailSubject: 'Tixly — výplata za vstupenky',
      items: [
        {
          sender_item_id: row.payout_id,
          receiver: row.paypal_payout_email!,
          amountValue: amountMajor.toFixed(2),
          currency,
          note: `Tixly výplata — ${row.payout_id.slice(0, 8)}`,
        },
      ],
    });

    await db().query(
      `UPDATE platform.payouts
       SET status = 'processing', payout_provider = 'paypal',
           external_payout_id = $2, executed_at = NOW(),
           failure_reason = NULL
       WHERE id = $1`,
      [row.payout_id, result.batchId],
    );

    return {
      payoutId: row.payout_id,
      status: 'paid',
      provider: 'paypal',
      externalId: result.batchId,
      reason: `status=${result.status}`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await failPayout(row.payout_id, reason, row.retry_count);
    return { payoutId: row.payout_id, status: 'failed', provider: 'paypal', reason };
  }
}

// ─── FIO (CZK domestic) ───────────────────────────────────────────────

async function executeFioPayout(
  row: PromoterPayoutRow,
  amountMajor: number,
): Promise<ExecuteResult> {
  // FIO outbound transfers require FIO Business API (separate credentials).
  // Currently manual — operator initiates from FIO Internet Banking.
  // Mark as 'processing' + note in failure_reason for visibility.
  await db().query(
    `UPDATE platform.payouts
     SET status = 'processing', payout_provider = 'fio',
         executed_at = NOW(), failure_reason = $2
     WHERE id = $1`,
    [
      row.payout_id,
      `Manual FIO transfer required: ${amountMajor.toFixed(2)} CZK to IBAN ${row.iban}. Ref: ${row.payout_id.slice(0, 8)}`,
    ],
  );

  return {
    payoutId: row.payout_id,
    status: 'paid',
    provider: 'fio',
    reason: 'Manual FIO — see failure_reason for transfer details',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function failPayout(payoutId: string, reason: string, retryCount: number): Promise<void> {
  const newStatus = retryCount + 1 >= MAX_RETRIES ? 'failed' : 'pending';
  await db().query(
    `UPDATE platform.payouts
     SET status = $2, failure_reason = $3,
         retry_count = retry_count + 1
     WHERE id = $1`,
    [payoutId, newStatus, reason.slice(0, 500)],
  );
}

/**
 * Fetch all pending payouts ready for execution.
 * Returns promoter payout data needed by executePayout().
 */
async function fetchPendingPayoutsImpl(limit = 50): Promise<PromoterPayoutRow[]> {
  const res = await db().query<PromoterPayoutRow>(
    `SELECT
       py.id AS payout_id,
       py.promoter_id,
       py.net_payout,
       py.currency,
       py.retry_count,
       p.name AS promoter_name,
       p.iban,
       p.swift_bic,
       p.payout_method,
       p.payout_currency,
       p.wise_recipient_id,
       p.paypal_payout_email
     FROM platform.payouts py
     JOIN platform.promoters p ON p.id = py.promoter_id
     WHERE py.status = 'pending'
       AND py.net_payout > 0
       AND py.retry_count < $1
     ORDER BY py.period_to ASC
     LIMIT $2`,
    [MAX_RETRIES, limit],
  );
  return res.rows;
}

// ── Servisni kontext (R-30, FINDINGS §147) ──────────────────────────────────
// Tenhle modul bezel BEZ kontextu, zatimco ostatni tri zapisovatele do
// platform.payouts (cron/event-payout-release, cron/payouts-auto-settle,
// payments/wise/webhook) obaleni jsou. Migrace 467 sama by nestacila: bez
// app.role='service' by policy p_payouts_service_write neplatila a UPDATE by
// dal tise vracel rowCount = 0.
//
// Vyplaty jsou vyhradne strojova cesta (crony + webhook banky), takze servisni
// kontext je spravny — nejde o uzivatelskou operaci.
export function executePayout(row: PromoterPayoutRow): Promise<ExecuteResult> {
  return runWithServiceContext(() => executePayoutImpl(row));
}

export function fetchPendingPayouts(limit = 50): Promise<PromoterPayoutRow[]> {
  return runWithServiceContext(() => fetchPendingPayoutsImpl(limit));
}
