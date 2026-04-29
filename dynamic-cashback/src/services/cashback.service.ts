// cashback.service.ts — hlavní service pro Dynamic Cashback.
// Implementuje výpočet personalizované sazby, uplatnění cashbacku,
// dotazy na zůstatek a historii a refresh cache přes cron.

import type { ServiceDeps } from '../lib/service-container.js';
import {
  type ApplyCashbackInput,
  type CashbackComponents,
  type CashbackConfig,
  type CashbackResult,
  DEFAULT_CASHBACK_CONFIG,
  type PersonalizedCashback,
  type RfmScore,
} from '../types/dynamic-cashback.js';
import { CashbackError } from '../lib/cashback-errors.js';
import { scoreRfm } from '../lib/rfm-calculator.js';
import { computePersonalizedRate } from '../lib/rate-calculator.js';

type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

interface ConfigRow {
  config: string | CashbackConfig;
}

function parseJson<T>(v: string | T): T {
  return typeof v === 'string' ? (JSON.parse(v) as T) : v;
}

export async function getPromoterConfig(
  deps: ServiceDeps,
  promoterId: string,
): Promise<CashbackConfig> {
  const rows = await deps.db.query<ConfigRow>(
    `SELECT config FROM dynamic_cashback.promoter_config
      WHERE promoter_id = $1 LIMIT 1`,
    [promoterId],
  );
  if (rows.length === 0) return DEFAULT_CASHBACK_CONFIG;
  const parsed = parseJson(rows[0]!.config);
  return { ...DEFAULT_CASHBACK_CONFIG, ...parsed };
}

export async function savePromoterConfig(
  deps: ServiceDeps,
  promoterId: string,
  config: CashbackConfig,
): Promise<void> {
  if (config.maxRateBps < 0 || config.maxRateBps > 2000) {
    throw new CashbackError(
      'INVALID_RATE',
      'maxRateBps musí být v rozsahu 0 až 2000.',
    );
  }
  await deps.db.execute(
    `INSERT INTO dynamic_cashback.promoter_config (promoter_id, config, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (promoter_id)
     DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [promoterId, JSON.stringify(config)],
  );
}

// ---------------------------------------------------------------------------
// Event boosts
// ---------------------------------------------------------------------------

interface EventBoostRow {
  event_id: string;
  promoter_id: string;
  boost_bps: string | number;
  valid_from: Date | string;
  valid_until: Date | string;
}

export async function getEventBoost(
  deps: ServiceDeps,
  eventId: string,
): Promise<number> {
  const rows = await deps.db.query<EventBoostRow>(
    `SELECT event_id, promoter_id, boost_bps, valid_from, valid_until
       FROM dynamic_cashback.event_boosts
      WHERE event_id = $1
        AND valid_from <= NOW()
        AND valid_until >= NOW()
      LIMIT 1`,
    [eventId],
  );
  if (rows.length === 0) return 0;
  return Number(rows[0]!.boost_bps);
}

export async function listEventBoosts(
  deps: ServiceDeps,
  promoterId: string,
): Promise<
  Array<{
    eventId: string;
    boostBps: number;
    validFrom: Date;
    validUntil: Date;
  }>
> {
  const rows = await deps.db.query<EventBoostRow>(
    `SELECT event_id, promoter_id, boost_bps, valid_from, valid_until
       FROM dynamic_cashback.event_boosts
      WHERE promoter_id = $1
      ORDER BY valid_from DESC`,
    [promoterId],
  );
  return rows.map((r) => ({
    eventId: r.event_id,
    boostBps: Number(r.boost_bps),
    validFrom: new Date(r.valid_from),
    validUntil: new Date(r.valid_until),
  }));
}

export async function createEventBoost(
  deps: ServiceDeps,
  input: {
    eventId: string;
    promoterId: string;
    boostBps: number;
    validFrom: Date;
    validUntil: Date;
  },
): Promise<void> {
  if (input.boostBps < 0 || input.boostBps > 2000) {
    throw new CashbackError('INVALID_RATE', 'Event boost musí být 0-2000 bps.');
  }
  await deps.db.execute(
    `INSERT INTO dynamic_cashback.event_boosts
       (event_id, promoter_id, boost_bps, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO UPDATE
        SET boost_bps = EXCLUDED.boost_bps,
            valid_from = EXCLUDED.valid_from,
            valid_until = EXCLUDED.valid_until`,
    [
      input.eventId,
      input.promoterId,
      input.boostBps,
      input.validFrom,
      input.validUntil,
    ],
  );
}

// ---------------------------------------------------------------------------
// RFM inputs from order history
// ---------------------------------------------------------------------------

interface RfmQueryRow {
  last_order_at: string | Date | null;
  order_count: string | number;
  total_spend_halire: string | number;
}

async function loadRfmInputs(
  deps: ServiceDeps,
  userId: string,
  promoterId: string,
): Promise<{
  recencyDays: number;
  frequency12m: number;
  monetaryHalire12m: number;
}> {
  const rows = await deps.db.query<RfmQueryRow>(
    `SELECT MAX(created_at) AS last_order_at,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '12 months') AS order_count,
            COALESCE(SUM(total_halire) FILTER (WHERE created_at > NOW() - INTERVAL '12 months'), 0) AS total_spend_halire
       FROM orders
      WHERE user_id = $1 AND promoter_id = $2 AND status = 'paid'`,
    [userId, promoterId],
  );

  const row = rows[0];
  if (!row || !row.last_order_at) {
    return {
      recencyDays: 99999,
      frequency12m: 0,
      monetaryHalire12m: 0,
    };
  }

  const last = new Date(row.last_order_at);
  const recencyDays = Math.floor(
    (Date.now() - last.getTime()) / (1000 * 60 * 60 * 24),
  );
  return {
    recencyDays,
    frequency12m: Number(row.order_count),
    monetaryHalire12m: Number(row.total_spend_halire),
  };
}

// ---------------------------------------------------------------------------
// Tier loader
// ---------------------------------------------------------------------------

interface TierRow {
  tier: string;
  lifetime_points: string | number;
}

async function loadUserTier(
  deps: ServiceDeps,
  userId: string,
): Promise<Tier> {
  const rows = await deps.db.query<TierRow>(
    `SELECT tier, lifetime_points FROM loyalty.accounts
      WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return 'bronze';
  const t = rows[0]!.tier;
  if (t === 'silver' || t === 'gold' || t === 'platinum' || t === 'bronze') {
    return t;
  }
  return 'bronze';
}

// ---------------------------------------------------------------------------
// Segment memberships loader
// ---------------------------------------------------------------------------

interface SegmentRow {
  segment_id: string;
}

async function loadUserSegments(
  deps: ServiceDeps,
  userId: string,
  promoterId: string,
): Promise<string[]> {
  const rows = await deps.db.query<SegmentRow>(
    `SELECT segment_id FROM audience_segmentation.segment_members
      WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );
  return rows.map((r) => r.segment_id);
}

// ---------------------------------------------------------------------------
// Rate cache
// ---------------------------------------------------------------------------

interface RateCacheRow {
  user_id: string;
  promoter_id: string;
  effective_rate_bps: string | number;
  components: string | CashbackComponents;
  reasons: string | string[];
  computed_at: string | Date;
  valid_until: string | Date;
}

function rowToRate(row: RateCacheRow): PersonalizedCashback {
  return {
    userId: row.user_id,
    promoterId: row.promoter_id,
    effectiveRateBps: Number(row.effective_rate_bps),
    components: parseJson(row.components),
    reasons: parseJson(row.reasons),
    computedAt: new Date(row.computed_at),
    validUntil: new Date(row.valid_until),
  };
}

async function loadCachedRate(
  deps: ServiceDeps,
  userId: string,
  promoterId: string,
): Promise<PersonalizedCashback | null> {
  const rows = await deps.db.query<RateCacheRow>(
    `SELECT user_id, promoter_id, effective_rate_bps, components, reasons,
            computed_at, valid_until
       FROM dynamic_cashback.rate_cache
      WHERE user_id = $1 AND promoter_id = $2
        AND valid_until > NOW()
      LIMIT 1`,
    [userId, promoterId],
  );
  return rows.length > 0 ? rowToRate(rows[0]!) : null;
}

async function saveCachedRate(
  deps: ServiceDeps,
  rate: PersonalizedCashback,
): Promise<void> {
  await deps.db.execute(
    `INSERT INTO dynamic_cashback.rate_cache
       (user_id, promoter_id, effective_rate_bps, components, reasons, computed_at, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, promoter_id) DO UPDATE
        SET effective_rate_bps = EXCLUDED.effective_rate_bps,
            components = EXCLUDED.components,
            reasons = EXCLUDED.reasons,
            computed_at = EXCLUDED.computed_at,
            valid_until = EXCLUDED.valid_until`,
    [
      rate.userId,
      rate.promoterId,
      rate.effectiveRateBps,
      JSON.stringify(rate.components),
      JSON.stringify(rate.reasons),
      rate.computedAt,
      rate.validUntil,
    ],
  );
}

// ---------------------------------------------------------------------------
// getPersonalizedRate
// ---------------------------------------------------------------------------

export async function getPersonalizedRate(
  userId: string,
  promoterId: string,
  eventId: string | undefined,
  deps: ServiceDeps,
): Promise<PersonalizedCashback> {
  // 1) Cache hit (ignoruj cache, pokud je event boost — per-event bonus
  //    nesmí být persistován napříč objednávkami).
  if (!eventId) {
    const cached = await loadCachedRate(deps, userId, promoterId);
    if (cached) return cached;
  }

  // 2) Load config
  const config = await getPromoterConfig(deps, promoterId);

  // 3) Tier
  const tier = await loadUserTier(deps, userId);

  // 4) RFM
  const rfmInputs = await loadRfmInputs(deps, userId, promoterId);
  const rfm: RfmScore = scoreRfm(rfmInputs);

  // 5) Segments
  const segments = await loadUserSegments(deps, userId, promoterId);

  // 6) Event boost
  const eventBoostBps = eventId ? await getEventBoost(deps, eventId) : 0;

  // 7) Compute
  const computed = computePersonalizedRate(
    tier,
    rfm,
    segments,
    eventBoostBps,
    config,
  );

  const now = new Date();
  const rate: PersonalizedCashback = {
    userId,
    promoterId,
    effectiveRateBps: computed.effectiveRateBps,
    components: computed.components,
    reasons: computed.reasons,
    computedAt: now,
    validUntil: new Date(now.getTime() + config.cacheTtlSeconds * 1000),
  };

  // Cache pouze pokud nebyl per-event boost (ten není součástí baseline).
  if (!eventId) {
    await saveCachedRate(deps, rate);
  }

  return rate;
}

// ---------------------------------------------------------------------------
// applyCashback
// ---------------------------------------------------------------------------

export async function applyCashback(
  input: ApplyCashbackInput,
  deps: ServiceDeps,
): Promise<CashbackResult> {
  if (input.orderAmountHalire <= 0) {
    throw new CashbackError(
      'INVALID_RATE',
      'Částka objednávky musí být kladná.',
    );
  }

  const rate = await getPersonalizedRate(
    input.userId,
    input.promoterId,
    input.eventId,
    deps,
  );

  if (rate.effectiveRateBps < 0 || rate.effectiveRateBps > 2000) {
    throw new CashbackError('RATE_CAP_EXCEEDED');
  }

  const cashbackHalire = Math.floor(
    (input.orderAmountHalire * rate.effectiveRateBps) / 10000,
  );

  // Transactional: insert ledger (idempotent via UNIQUE) + update balances
  const ledgerEntryId = await deps.db.transaction(async (tx) => {
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM dynamic_cashback.ledger
        WHERE user_id = $1 AND order_id = $2 LIMIT 1`,
      [input.userId, input.orderId],
    );
    if (existing.length > 0) {
      throw new CashbackError('LEDGER_DUPLICATE');
    }

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO dynamic_cashback.ledger
         (user_id, promoter_id, order_id, amount_halire, rate_bps, components)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.userId,
        input.promoterId,
        input.orderId,
        cashbackHalire,
        rate.effectiveRateBps,
        JSON.stringify(rate.components),
      ],
    );

    await tx.execute(
      `INSERT INTO dynamic_cashback.balances
         (user_id, promoter_id, available_halire, lifetime_earned_halire, lifetime_redeemed_halire, updated_at)
       VALUES ($1, $2, $3, $3, 0, NOW())
       ON CONFLICT (user_id, promoter_id) DO UPDATE
          SET available_halire = dynamic_cashback.balances.available_halire + EXCLUDED.available_halire,
              lifetime_earned_halire = dynamic_cashback.balances.lifetime_earned_halire + EXCLUDED.available_halire,
              updated_at = NOW()`,
      [input.userId, input.promoterId, cashbackHalire],
    );

    return inserted[0]!.id;
  });

  deps.kafka
    .send('dynamic_cashback.earned', {
      userId: input.userId,
      promoterId: input.promoterId,
      orderId: input.orderId,
      orderAmountHalire: input.orderAmountHalire,
      cashbackHalire,
      rateBps: rate.effectiveRateBps,
      components: rate.components,
      timestamp: new Date().toISOString(),
    })
    .catch(() => {
      /* best-effort */
    });

  return { cashbackHalire, rate, ledgerEntryId };
}

// ---------------------------------------------------------------------------
// Balance & history
// ---------------------------------------------------------------------------

interface BalanceRow {
  available_halire: string | number;
  lifetime_earned_halire: string | number;
  lifetime_redeemed_halire: string | number;
}

export async function getUserCashbackBalance(
  userId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<{
  availableHalire: number;
  lifetimeEarnedHalire: number;
  lifetimeRedeemedHalire: number;
}> {
  const rows = await deps.db.query<BalanceRow>(
    `SELECT available_halire, lifetime_earned_halire, lifetime_redeemed_halire
       FROM dynamic_cashback.balances
      WHERE user_id = $1 AND promoter_id = $2 LIMIT 1`,
    [userId, promoterId],
  );
  if (rows.length === 0) {
    return {
      availableHalire: 0,
      lifetimeEarnedHalire: 0,
      lifetimeRedeemedHalire: 0,
    };
  }
  const r = rows[0]!;
  return {
    availableHalire: Number(r.available_halire),
    lifetimeEarnedHalire: Number(r.lifetime_earned_halire),
    lifetimeRedeemedHalire: Number(r.lifetime_redeemed_halire),
  };
}

interface LedgerHistoryRow {
  id: string;
  order_id: string;
  amount_halire: string | number;
  rate_bps: string | number;
  created_at: string | Date;
}

export async function listCashbackHistory(
  userId: string,
  promoterId: string,
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{
  items: Array<{
    id: string;
    orderId: string;
    amountHalire: number;
    rateBps: number;
    createdAt: Date;
  }>;
  total: number;
}> {
  const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 500);
  const offset = Math.max(pagination.offset ?? 0, 0);

  const rows = await deps.db.query<LedgerHistoryRow>(
    `SELECT id, order_id, amount_halire, rate_bps, created_at
       FROM dynamic_cashback.ledger
      WHERE user_id = $1 AND promoter_id = $2
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [userId, promoterId, limit, offset],
  );

  const countRows = await deps.db.query<{ count: string | number }>(
    `SELECT COUNT(*)::int AS count FROM dynamic_cashback.ledger
      WHERE user_id = $1 AND promoter_id = $2`,
    [userId, promoterId],
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      amountHalire: Number(r.amount_halire),
      rateBps: Number(r.rate_bps),
      createdAt: new Date(r.created_at),
    })),
    total: Number(countRows[0]?.count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Cron: refresh stale rates
// ---------------------------------------------------------------------------

export async function refreshStaleRates(
  deps: ServiceDeps,
): Promise<{ refreshed: number }> {
  const stale = await deps.db.query<{ user_id: string; promoter_id: string }>(
    `DELETE FROM dynamic_cashback.rate_cache
      WHERE valid_until <= NOW()
      RETURNING user_id, promoter_id`,
  );
  return { refreshed: stale.length };
}
