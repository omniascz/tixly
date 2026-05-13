// 4-level payment matching engine — adapted from Accounting project
// Uses Tixly's DbAdapter (raw SQL), integer haléře, orders.orders table.

import type { DbAdapter } from '@tixly/db-adapter';

/* ---------- Types ---------- */

export type MatchLevel = 1 | 2 | 3 | 4;

export interface MatchCandidate {
  orderId: string;
  variableSymbol: string | null;
  expectedAmountHalire: number;
  currency: string;
  /** Customer name from order (for fuzzy matching display) */
  customerName?: string;
  matchLevel: MatchLevel;
  /** 0.0000 – 1.0000 */
  matchScore: number;
  matchReasons: string[];
}

export interface MatchResult {
  bankPaymentId: string;
  amountHalire: number;
  currency: string;
  status: 'matched' | 'partial_match' | 'overpaid' | 'unmatched' | 'multi_match';
  candidates: MatchCandidate[];
  selectedMatch?: MatchCandidate;
  remainingHalire?: number;
  autoMatched: boolean;
}

export interface MatchingConfig {
  /** Minimum score for auto-match (default 0.95) */
  autoMatchThreshold: number;
  /** Max difference in haléře for Level 3 fuzzy amount match (default 100 = 1 CZK) */
  fuzzyAmountToleranceHalire: number;
  /** Enable Level 4 AI-based matching */
  enableLevel4Ai: boolean;
  /** Max candidates to return per transaction */
  maxCandidates: number;
}

export const DEFAULT_MATCHING_CONFIG: MatchingConfig = {
  autoMatchThreshold: 0.95,
  fuzzyAmountToleranceHalire: 100, // 1 CZK
  enableLevel4Ai: false,
  maxCandidates: 10,
};

/* ---------- AI provider abstraction (mockable) ---------- */

export type AiMatchProvider = (
  payment: Record<string, unknown>,
  orders: Array<Record<string, unknown>>,
) => Promise<Array<{ orderId: string; score: number; reason: string }>>;

let _aiProvider: AiMatchProvider | null = null;

export function setAiMatchProvider(provider: AiMatchProvider): void {
  _aiProvider = provider;
}

export function getAiMatchProvider(): AiMatchProvider | null {
  return _aiProvider;
}

/* ---------- DB row types ---------- */

interface OrderRow {
  id: string;
  variable_symbol: string | null;
  total_halire: number | string;
  currency: string;
  customer_name: string | null;
  status: string;
}

/* ---------- Level 1: Exact match — VS + exact amount + currency ---------- */

export async function matchLevel1(
  db: DbAdapter,
  variableSymbol: string,
  amountHalire: number,
  currency: string,
): Promise<MatchCandidate[]> {
  if (!variableSymbol) return [];

  const rows = await db.query<OrderRow>(
    `SELECT id, variable_symbol, total_halire, currency, customer_name, status
       FROM orders.orders
      WHERE variable_symbol = $1
        AND currency = $2
        AND status IN ('pending', 'awaiting_payment')
      ORDER BY created_at ASC`,
    [variableSymbol, currency],
  );

  const candidates: MatchCandidate[] = [];

  for (const row of rows) {
    const expected = Number(row.total_halire);
    if (expected === amountHalire) {
      candidates.push({
        orderId: row.id,
        variableSymbol: row.variable_symbol,
        expectedAmountHalire: expected,
        currency: row.currency,
        customerName: row.customer_name ?? undefined,
        matchLevel: 1,
        matchScore: 1.0,
        matchReasons: [
          `Variable symbol matches: ${variableSymbol}`,
          `Exact amount match: ${amountHalire} hal ${currency}`,
        ],
      });
    }
  }

  return candidates;
}

/* ---------- Level 2: VS matches, amount differs ---------- */

export async function matchLevel2(
  db: DbAdapter,
  variableSymbol: string,
  amountHalire: number,
  currency: string,
): Promise<MatchCandidate[]> {
  if (!variableSymbol) return [];

  const rows = await db.query<OrderRow>(
    `SELECT id, variable_symbol, total_halire, currency, customer_name, status
       FROM orders.orders
      WHERE variable_symbol = $1
        AND currency = $2
        AND status IN ('pending', 'awaiting_payment')
      ORDER BY created_at ASC`,
    [variableSymbol, currency],
  );

  const candidates: MatchCandidate[] = [];

  for (const row of rows) {
    const expected = Number(row.total_halire);
    if (expected === amountHalire) continue; // exact match handled by L1

    const isPartial = amountHalire < expected;
    const ratio = isPartial
      ? amountHalire / expected
      : expected / amountHalire;
    // VS match gives high base, amount diff penalizes
    const score = Math.min(0.9, 0.7 + ratio * 0.2);

    const reasons: string[] = [`Variable symbol matches: ${variableSymbol}`];
    if (isPartial) {
      reasons.push(`Partial payment: ${amountHalire} of ${expected} hal ${currency}`);
    } else {
      reasons.push(`Overpayment: ${amountHalire} exceeds ${expected} hal ${currency}`);
    }

    candidates.push({
      orderId: row.id,
      variableSymbol: row.variable_symbol,
      expectedAmountHalire: expected,
      currency: row.currency,
      customerName: row.customer_name ?? undefined,
      matchLevel: 2,
      matchScore: score,
      matchReasons: reasons,
    });
  }

  return candidates;
}

/* ---------- Level 3: No VS, match by amount + counterparty ---------- */

export async function matchLevel3(
  db: DbAdapter,
  amountHalire: number,
  currency: string,
  counterpartyAccount?: string,
  counterpartyName?: string,
  toleranceHalire?: number,
): Promise<MatchCandidate[]> {
  const tol = toleranceHalire ?? DEFAULT_MATCHING_CONFIG.fuzzyAmountToleranceHalire;

  // Find open orders with amount within tolerance
  const rows = await db.query<OrderRow>(
    `SELECT id, variable_symbol, total_halire, currency, customer_name, status
       FROM orders.orders
      WHERE currency = $1
        AND status IN ('pending', 'awaiting_payment')
        AND ABS(total_halire - $2) <= $3
      ORDER BY ABS(total_halire - $2) ASC
      LIMIT 20`,
    [currency, amountHalire, tol],
  );

  const candidates: MatchCandidate[] = [];

  for (const row of rows) {
    const expected = Number(row.total_halire);
    const diff = Math.abs(amountHalire - expected);

    let score = 0.5; // base for amount-only match
    const reasons: string[] = [];

    if (diff === 0) {
      reasons.push(`Exact amount match: ${amountHalire} hal ${currency}`);
      score += 0.2;
    } else {
      reasons.push(
        `Amount within tolerance: ${amountHalire} vs ${expected} hal ${currency} (diff: ${diff})`,
      );
      score += 0.1;
    }

    // Counterparty info boosts score
    if (counterpartyAccount) {
      reasons.push(`Counterparty account available: ${counterpartyAccount}`);
      score += 0.15;
    }
    if (counterpartyName) {
      reasons.push(`Counterparty name available: ${counterpartyName}`);
      score += 0.1;
    }

    score = Math.min(score, 0.89); // Level 3 capped below auto-match threshold

    candidates.push({
      orderId: row.id,
      variableSymbol: row.variable_symbol,
      expectedAmountHalire: expected,
      currency: row.currency,
      customerName: row.customer_name ?? undefined,
      matchLevel: 3,
      matchScore: score,
      matchReasons: reasons,
    });
  }

  return candidates;
}

/* ---------- Level 4: AI-based fuzzy matching ---------- */

export async function matchLevel4(
  db: DbAdapter,
  payment: Record<string, unknown>,
  currency: string,
): Promise<MatchCandidate[]> {
  const provider = _aiProvider;
  if (!provider) return [];

  const rows = await db.query<OrderRow>(
    `SELECT id, variable_symbol, total_halire, currency, customer_name, status
       FROM orders.orders
      WHERE currency = $1
        AND status IN ('pending', 'awaiting_payment')
      ORDER BY created_at DESC
      LIMIT 50`,
    [currency],
  );

  if (rows.length === 0) return [];

  try {
    const aiResults = await provider(
      payment,
      rows as unknown as Array<Record<string, unknown>>,
    );
    return aiResults.map((r) => {
      const order = rows.find((o) => o.id === r.orderId);
      return {
        orderId: r.orderId,
        variableSymbol: order?.variable_symbol ?? null,
        expectedAmountHalire: Number(order?.total_halire ?? 0),
        currency: order?.currency ?? currency,
        customerName: order?.customer_name ?? undefined,
        matchLevel: 4 as MatchLevel,
        matchScore: Math.min(r.score, 0.85), // AI capped at 0.85
        matchReasons: [`AI match: ${r.reason}`],
      };
    });
  } catch {
    // AI matching should never block — return empty on failure
    return [];
  }
}

/* ---------- matchPayment — orchestrates all 4 levels ---------- */

export interface PaymentInput {
  id: string;
  amountHalire: number;
  currency: string;
  variableSymbol?: string | null;
  specificSymbol?: string | null;
  constantSymbol?: string | null;
  counterAccount?: string | null;
  counterAccountName?: string | null;
  message?: string | null;
  receivedAt: Date;
}

export async function matchPayment(
  db: DbAdapter,
  payment: PaymentInput,
  config?: Partial<MatchingConfig>,
): Promise<MatchResult> {
  const cfg: MatchingConfig = { ...DEFAULT_MATCHING_CONFIG, ...config };
  const { amountHalire, currency } = payment;
  const vs = payment.variableSymbol ?? undefined;

  let allCandidates: MatchCandidate[] = [];

  // Level 1: Exact VS + amount
  if (vs) {
    const l1 = await matchLevel1(db, vs, amountHalire, currency);
    allCandidates.push(...l1);
  }

  // Level 2: VS matches, amount differs (only if no L1 hit)
  if (vs && allCandidates.length === 0) {
    const l2 = await matchLevel2(db, vs, amountHalire, currency);
    allCandidates.push(...l2);
  }

  // Level 3: Fuzzy amount + counterparty (only if no L1/L2 hit)
  if (allCandidates.length === 0) {
    const l3 = await matchLevel3(
      db,
      amountHalire,
      currency,
      payment.counterAccount ?? undefined,
      payment.counterAccountName ?? undefined,
      cfg.fuzzyAmountToleranceHalire,
    );
    allCandidates.push(...l3);
  }

  // Level 4: AI matching (only if no hits so far and enabled)
  if (allCandidates.length === 0 && cfg.enableLevel4Ai) {
    const l4 = await matchLevel4(
      db,
      payment as unknown as Record<string, unknown>,
      currency,
    );
    allCandidates.push(...l4);
  }

  // Sort by score descending and limit
  allCandidates.sort((a, b) => b.matchScore - a.matchScore);
  allCandidates = allCandidates.slice(0, cfg.maxCandidates);

  // No candidates
  if (allCandidates.length === 0) {
    return {
      bankPaymentId: payment.id,
      amountHalire,
      currency,
      status: 'unmatched',
      candidates: [],
      autoMatched: false,
    };
  }

  const best = allCandidates[0]!;
  const autoMatch = best.matchScore >= cfg.autoMatchThreshold;

  let status: MatchResult['status'];
  if (allCandidates.length > 1 && !autoMatch) {
    status = 'multi_match';
  } else if (best.matchLevel === 2) {
    status = amountHalire < best.expectedAmountHalire ? 'partial_match' : 'overpaid';
  } else {
    status = 'matched';
  }

  const remainingHalire =
    status === 'partial_match'
      ? best.expectedAmountHalire - amountHalire
      : status === 'overpaid'
        ? amountHalire - best.expectedAmountHalire
        : undefined;

  // Auto-apply if threshold met
  if (autoMatch) {
    try {
      await applyMatch(db, payment.id, best.orderId, best, amountHalire);
    } catch {
      return {
        bankPaymentId: payment.id,
        amountHalire,
        currency,
        status,
        candidates: allCandidates,
        selectedMatch: best,
        remainingHalire,
        autoMatched: false,
      };
    }
  }

  return {
    bankPaymentId: payment.id,
    amountHalire,
    currency,
    status,
    candidates: allCandidates,
    selectedMatch: autoMatch ? best : undefined,
    remainingHalire,
    autoMatched: autoMatch,
  };
}

/* ---------- applyMatch — persist match + update statuses ---------- */

export async function applyMatch(
  db: DbAdapter,
  bankPaymentId: string,
  orderId: string,
  candidate: MatchCandidate,
  amountHalire: number,
  matchedByUserId?: string,
): Promise<void> {
  const matchAmount = Math.min(amountHalire, candidate.expectedAmountHalire);

  await db.transaction(async (tx) => {
    // 1) Insert audit log
    await tx.execute(
      `INSERT INTO payments.payment_match_log
         (bank_payment_id, order_id, match_level, match_score, matched_amount, was_auto, matched_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        bankPaymentId,
        orderId,
        candidate.matchLevel,
        candidate.matchScore,
        matchAmount,
        matchedByUserId == null, // was_auto = true when no user
        matchedByUserId ?? null,
        JSON.stringify({
          reasons: candidate.matchReasons,
          payment_amount: amountHalire,
          expected_amount: candidate.expectedAmountHalire,
        }),
      ],
    );

    // 2) Determine match_status for bank_payment
    let bankStatus: string;
    if (amountHalire === candidate.expectedAmountHalire) {
      bankStatus = 'matched';
    } else if (amountHalire < candidate.expectedAmountHalire) {
      bankStatus = 'partial_match';
    } else {
      bankStatus = 'overpaid'; // keep original Tixly status name
    }

    // 3) Update bank_payment
    await tx.execute(
      `UPDATE payments.bank_payments
          SET match_status = $1,
              order_id = $2,
              matched_at = NOW(),
              match_level = $3,
              match_confidence = $4
        WHERE id = $5`,
      [
        bankStatus,
        orderId,
        candidate.matchLevel,
        JSON.stringify({
          score: candidate.matchScore,
          level: candidate.matchLevel,
          reasons: candidate.matchReasons,
        }),
        bankPaymentId,
      ],
    );

    // 4) Update order status if exact or overpaid
    if (amountHalire >= candidate.expectedAmountHalire) {
      await tx.execute(
        `UPDATE orders.orders
            SET status = 'paid', paid_at = NOW()
          WHERE id = $1 AND status IN ('pending', 'awaiting_payment')`,
        [orderId],
      );
    }
  });
}

/* ---------- matchAllUnmatched — batch matching ---------- */

export async function matchAllUnmatched(
  db: DbAdapter,
  config?: Partial<MatchingConfig>,
): Promise<{
  matched: number;
  partialMatched: number;
  multiMatch: number;
  unmatched: number;
  results: MatchResult[];
}> {
  interface BankPaymentRow {
    id: string;
    amount_halire: number | string;
    currency: string;
    variable_symbol: string | null;
    specific_symbol: string | null;
    constant_symbol: string | null;
    counter_account: string | null;
    counter_account_name: string | null;
    message: string | null;
    received_at: Date | string;
  }

  const rows = await db.query<BankPaymentRow>(
    `SELECT id, amount_halire, currency, variable_symbol, specific_symbol,
            constant_symbol, counter_account, counter_account_name, message, received_at
       FROM payments.bank_payments
      WHERE match_status = 'unmatched'
      ORDER BY received_at ASC`,
  );

  const results: MatchResult[] = [];
  let matched = 0;
  let partialMatched = 0;
  let multiMatch = 0;
  let unmatched = 0;

  for (const row of rows) {
    const result = await matchPayment(db, {
      id: row.id,
      amountHalire: Number(row.amount_halire),
      currency: row.currency,
      variableSymbol: row.variable_symbol,
      specificSymbol: row.specific_symbol,
      constantSymbol: row.constant_symbol,
      counterAccount: row.counter_account,
      counterAccountName: row.counter_account_name,
      message: row.message,
      receivedAt: row.received_at instanceof Date ? row.received_at : new Date(row.received_at),
    }, config);

    results.push(result);

    if (result.status === 'matched') matched++;
    else if (result.status === 'partial_match') partialMatched++;
    else if (result.status === 'multi_match') multiMatch++;
    else unmatched++;
  }

  return { matched, partialMatched, multiMatch, unmatched, results };
}

/* ---------- getMatchingStats ---------- */

export async function getMatchingStats(
  db: DbAdapter,
  period?: { from: Date; to: Date },
): Promise<{
  totalTransactions: number;
  autoMatched: number;
  manuallyMatched: number;
  unmatched: number;
  matchRatePercent: number;
  byLevel: Record<MatchLevel, number>;
}> {
  // Count from audit log
  let logQuery = `SELECT match_level, was_auto, COUNT(*)::int AS cnt
                    FROM payments.payment_match_log`;
  const logParams: unknown[] = [];

  if (period) {
    logQuery += ` WHERE matched_at >= $1 AND matched_at <= $2`;
    logParams.push(period.from.toISOString(), period.to.toISOString());
  }

  logQuery += ` GROUP BY match_level, was_auto`;

  const logRows = await db.query<{ match_level: number; was_auto: boolean; cnt: number }>(
    logQuery,
    logParams,
  );

  let autoMatched = 0;
  let manuallyMatched = 0;
  const byLevel: Record<MatchLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const row of logRows) {
    const cnt = Number(row.cnt);
    if (row.was_auto) autoMatched += cnt;
    else manuallyMatched += cnt;
    const level = row.match_level as MatchLevel;
    if (level >= 1 && level <= 4) byLevel[level] += cnt;
  }

  // Count unmatched bank payments
  const unmatchedRows = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM payments.bank_payments
      WHERE match_status = 'unmatched'`,
  );

  const unmatchedCount = Number(unmatchedRows[0]?.cnt ?? 0);
  const totalMatched = autoMatched + manuallyMatched;
  const totalTransactions = totalMatched + unmatchedCount;
  const matchRatePercent =
    totalTransactions > 0 ? Math.round((totalMatched / totalTransactions) * 10000) / 100 : 0;

  return {
    totalTransactions,
    autoMatched,
    manuallyMatched,
    unmatched: unmatchedCount,
    matchRatePercent,
    byLevel,
  };
}
