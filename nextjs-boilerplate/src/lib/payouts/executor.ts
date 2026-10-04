/**
 * Unified payout executor.
 *
 * Picks the right payout provider for each pending payout record and executes it.
 * Called by the payouts-execute cron job.
 *
 * Provider selection:
 *   1. Explicit payout_method on promoter (sepa_credit | wise → Wise)
 *      paypal je VYRAZENY — payout_method_check ho nepovoluje a sloupec
 *      paypal_payout_email v schematu neexistuje (§203, §206).
 *   2. Currency-based auto-routing:
 *      - EUR/GBP/PLN/non-CZK → Wise (covers SEPA + SWIFT)
 *      - CZK → FIO (existing CZ bank transfer)
 *   3. If no IBAN and no PayPal email → log and skip (operator must fix promoter data)
 *
 * Failure handling:
 *   - On API error: status = 'failed', failure_reason set, retry_count incremented
 *   - After 3 failures: status stays 'failed' (manual review required)
 *   - Wise: status = 'processing' + external_payout_id; do 'paid' až webhook po potvrzení Wise API.
 *   - CZK (FIO): převod dělá člověk → status = 'awaiting_manual_transfer'; do 'paid' až platform admin
 *     potvrdí převod s datem a referencí (POST /api/platform/admin/payouts/[id]/confirm-transfer).
 *   Kolo 7 (C-57): dřív obě cesty hlásily 'paid', i když peníze (FIO) vůbec neodešly. 'paid' bez
 *   potvrzení dnes odmítne DB (trigger trg_payouts_paid_guard, migrace 497).
 */

import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import {
  getWiseConfig,
  createWiseRecipient,
  createAndFundWiseTransfer,
} from './wise';

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
}

/**
 * Kanaly, ktere se smi provest. Mimo tenhle vycet cesta selze PRED dotazem.
 * payout_method_check na platform.promoters povoluje
 * bank_transfer | sepa_credit | wise — paypal v nem NENI (§203).
 */
export const ENABLED_PAYOUT_CHANNELS = new Set(['bank_transfer', 'sepa_credit', 'wise']);

type ExecuteResult = {
  payoutId: string;
  status: 'processing' | 'awaiting_manual_transfer' | 'skipped' | 'failed';
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
  // ─── ENABLED_PAYOUT_CHANNELS (§203 d) ──────────────────────────────────────
  // Vzorem DISABLED_REPORTS / ALLOWED_JOBS: neznamy nebo vyrazeny kanal ma
  // selhat SROZUMITELNE a HNED, ne az 42703 uprostred prevodu penez.
  //   'paypal' — payout_method_check ho nepovoluje a paypal_payout_email
  //              v schematu neexistuje. Vyrazeno.
  //   NULL     — projde, radi se dal podle meny a IBAN (dnesni chovani).
  const method = row.payout_method;
  if (method !== null && !ENABLED_PAYOUT_CHANNELS.has(method)) {
    const reason = `payout channel disabled: ${method}`;
    await failPayout(row.payout_id, reason, row.retry_count);
    return { payoutId: row.payout_id, status: 'failed', reason };
  }
  const currency = row.payout_currency ?? row.currency;
  const isEurLike = currency !== 'CZK';

  // Wise path: explicit wise/sepa_credit OR non-CZK currency with IBAN
  if ((method === 'wise' || method === 'sepa_credit' || isEurLike) && row.iban) {
    return executeWisePayout(row, amountMajor, currency);
  }

  // CZK domestic: FIO Bank (mock — FIO integration exists but is manual)
  if (currency === 'CZK' && row.iban) {
    return executeFioPayout(row, amountMajor);
  }

  // Cannot execute — missing payout details
  const reason = !row.iban
    ? 'Promoter has no IBAN configured'
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
    // §206: `wise_recipient_id` na `platform.promoters` NEEXISTUJE, takze se
    // recipient necachuje a zaklada se pri kazde vyplate. Varianta A —
    // cena je jedno API volani navic, zisk je, ze cesta vubec bezi.
    const recipient = await createWiseRecipient({
      accountHolderName: row.promoter_name,
      currency: targetCurrency,
      iban: row.iban!,
      bic: row.swift_bic ?? undefined,
      legalType: 'BUSINESS',
    });
    const recipientId = recipient.id;

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
      status: 'processing',
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


// ─── FIO (CZK domestic) ───────────────────────────────────────────────

async function executeFioPayout(
  row: PromoterPayoutRow,
  amountMajor: number,
): Promise<ExecuteResult> {
  // FIO outbound transfers require FIO Business API (separate credentials) — nenapojeno.
  // Převod zadává člověk v internetovém bankovnictví → čeká na ruční převod, ne 'paid'.
  await db().query(
    `UPDATE platform.payouts
     SET status = 'awaiting_manual_transfer', payout_provider = 'fio',
         executed_at = NULL, failure_reason = NULL
     WHERE id = $1`,
    [row.payout_id],
  );

  return {
    payoutId: row.payout_id,
    status: 'awaiting_manual_transfer',
    provider: 'fio',
    reason: `Ruční převod ${amountMajor.toFixed(2)} CZK na IBAN ${row.iban}, VS/ref ${row.payout_id.slice(0, 8)}`,
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
       p.primary_currency AS payout_currency
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
