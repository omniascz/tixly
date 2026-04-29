// loyalty-tier-cashback.service.ts — rozšíření loyalty modulu:
//   1) redeemPointsForCashback — uplatnění bodů jako slevy s capem 50 % objednávky
//   2) recomputeTiers          — denní cron pro downgrade tierů (90denní okno)
//   3) getPromoterLoyaltyConfig — per-promoter override prahů a multiplikátorů
//
// Všechny peněžní hodnoty v haléřích. Tento soubor doplňuje (nemění)
// stávající loyalty.service.ts — ať nejsou breaking změny stávajícího API.

import type { DbAdapter } from '@tixly/rls-multitenancy';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { LoyaltyTier } from '../types/loyalty.types.js';
import {
  TIER_THRESHOLDS,
  TIER_MULTIPLIERS,
  InsufficientPointsError,
  InvalidRedemptionError,
} from '../types/loyalty.types.js';
import { calculateDiscount, getTier } from '../lib/points-calculator.js';

interface KafkaAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaAdapter;
}

// ---------------------------------------------------------------------------
// Per-promoter config
// ---------------------------------------------------------------------------

export interface PromoterLoyaltyConfig {
  promoterId: string;
  /** Prahy lifetimePoints pro jednotlivé tiery (bronze vždy = 0) */
  tierThresholds: Record<LoyaltyTier, number>;
  /** Multiplikátory earn rate */
  tierMultipliers: Record<LoyaltyTier, number>;
  /** Základní earn rate v bodech za 1 Kč (default 1) */
  baseEarnRate: number;
  /** Max % objednávky uhraditelné cashbackem (0..1) */
  cashbackCapPct: number;
  /** Kolik haléřů slevy = 1 bod (default 1 halíř = 1 bod) */
  cashbackConversionHalirePerPoint: number;
}

export const DEFAULT_PROMOTER_CONFIG: Omit<PromoterLoyaltyConfig, 'promoterId'> = {
  tierThresholds: { ...TIER_THRESHOLDS },
  tierMultipliers: { ...TIER_MULTIPLIERS },
  baseEarnRate: 1,
  cashbackCapPct: 0.5,
  cashbackConversionHalirePerPoint: 1,
};

interface PromoterConfigRow {
  promoter_id: string;
  tier_thresholds: string | Record<string, number>;
  tier_multipliers: string | Record<string, number>;
  base_earn_rate: string | number;
  cashback_cap_pct: string | number;
  cashback_conversion_halire_per_point: string | number;
}

function parseJson<T>(v: string | T): T {
  return typeof v === 'string' ? (JSON.parse(v) as T) : v;
}

/**
 * Načte konfiguraci loyalty programu pro daného promotéra.
 * Pokud záznam neexistuje, vrátí DEFAULT_PROMOTER_CONFIG.
 */
export async function getPromoterLoyaltyConfig(
  deps: ServiceDeps,
  promoterId: string,
): Promise<PromoterLoyaltyConfig> {
  const rows = await deps.db.query<PromoterConfigRow>(
    `SELECT promoter_id,
            tier_thresholds,
            tier_multipliers,
            base_earn_rate,
            cashback_cap_pct,
            cashback_conversion_halire_per_point
       FROM loyalty.promoter_config
      WHERE promoter_id = $1
      LIMIT 1`,
    [promoterId],
  );

  if (rows.length === 0) {
    return { promoterId, ...DEFAULT_PROMOTER_CONFIG };
  }

  const row = rows[0]!;
  return {
    promoterId: row.promoter_id,
    tierThresholds: parseJson(row.tier_thresholds) as Record<LoyaltyTier, number>,
    tierMultipliers: parseJson(row.tier_multipliers) as Record<LoyaltyTier, number>,
    baseEarnRate: Number(row.base_earn_rate),
    cashbackCapPct: Number(row.cashback_cap_pct),
    cashbackConversionHalirePerPoint: Number(row.cashback_conversion_halire_per_point),
  };
}

// ---------------------------------------------------------------------------
// redeemPointsForCashback
// ---------------------------------------------------------------------------

export interface CashbackRedeemResult {
  discountHalire: number;
  remainingBalance: number;
}

/**
 * Uplatní body jako cashback slevu na konkrétní objednávku.
 *
 * Pravidla:
 *   - 1 bod = 1 halíř slevy (konfigurovatelně per promoter)
 *   - Max 50 % objednávky lze uhradit body (konfigurovatelně)
 *   - Validace dostatečného zůstatku
 *   - Atomické v DB transakci (SELECT FOR UPDATE)
 *   - Emituje Kafka loyalty.points_redeemed
 *
 * @param userId        - ID zákazníka
 * @param points        - kolik bodů chce uplatnit
 * @param orderId       - ID objednávky
 * @param orderAmount   - částka objednávky v haléřích (pro výpočet capu)
 * @param promoterId    - ID promotéra (pro load configu)
 * @param deps          - injektované závislosti
 */
export async function redeemPointsForCashback(
  deps: ServiceDeps,
  userId: string,
  points: number,
  orderId: string,
  orderAmount: number,
  promoterId: string,
): Promise<CashbackRedeemResult> {
  if (points <= 0) {
    throw new InvalidRedemptionError('Počet bodů musí být kladný.');
  }
  if (orderAmount <= 0) {
    throw new InvalidRedemptionError('Částka objednávky musí být kladná.');
  }

  const config = await getPromoterLoyaltyConfig(deps, promoterId);
  const requestedHalire = points * config.cashbackConversionHalirePerPoint;
  const maxCashbackHalire = Math.floor(orderAmount * config.cashbackCapPct);

  if (requestedHalire > maxCashbackHalire) {
    throw new InvalidRedemptionError(
      `Cashback přesahuje limit ${Math.round(config.cashbackCapPct * 100)} % objednávky ` +
        `(max ${maxCashbackHalire} haléřů, požadováno ${requestedHalire}).`,
    );
  }

  return withTenantContext(deps.db, { userId, role: 'buyer' }, async (db) => {
    return db.transaction(async (tx) => {
      const rows = await tx.query<{ total_points: string | number }>(
        `SELECT total_points FROM loyalty.accounts
          WHERE user_id = $1 LIMIT 1 FOR UPDATE`,
        [userId],
      );

      const available = rows.length > 0 ? Number(rows[0]!.total_points) : 0;
      if (available < points) {
        throw new InsufficientPointsError(available, points);
      }

      const newBalance = available - points;

      await tx.execute(
        `UPDATE loyalty.accounts SET total_points = $1 WHERE user_id = $2`,
        [newBalance, userId],
      );

      await tx.execute(
        `INSERT INTO loyalty.transactions
           (user_id, type, points, order_id, description)
         VALUES ($1, 'redeemed', $2, $3, $4)
         ON CONFLICT (user_id, order_id) DO NOTHING`,
        [
          userId,
          points,
          orderId,
          `Cashback ${points} bodů na objednávku ${orderId} ` +
            `(${calculateDiscount(points) / 100} Kč sleva)`,
        ],
      );

      deps.kafka
        .send('loyalty.points_redeemed', {
          userId,
          orderId,
          points,
          option: 'cashback',
          discountHalire: requestedHalire,
          remainingBalance: newBalance,
          timestamp: new Date().toISOString(),
        })
        .catch(() => {
          /* best-effort */
        });

      return { discountHalire: requestedHalire, remainingBalance: newBalance };
    });
  });
}

// ---------------------------------------------------------------------------
// recomputeTiers — denní cron pro downgrade
// ---------------------------------------------------------------------------

interface RecentEarnRow {
  user_id: string;
  tier: string;
  recent_points: string | number;
}

export interface TierRecomputeResult {
  scanned: number;
  demoted: number;
}

/**
 * Denní cron: pokud za posledních 90 dní zákazník nezískal dost bodů,
 * aby si udržel current tier, tier je demoted dle recent earn.
 *
 * Pozn.: lifetimePoints se NEODEČÍTÁ — pouze tier (zobrazovaná hodnota)
 * se aktualizuje na úroveň odpovídající aktivitě za poslední 3 měsíce.
 *
 * Emituje loyalty.tier.changed pro každý demoted account.
 */
export async function recomputeTiers(
  deps: ServiceDeps,
): Promise<TierRecomputeResult> {
  const rows = await deps.db.query<RecentEarnRow>(
    `SELECT a.user_id, a.tier,
            COALESCE(SUM(t.points) FILTER (
              WHERE t.type = 'earned' AND t.created_at > NOW() - INTERVAL '90 days'
            ), 0) AS recent_points
       FROM loyalty.accounts a
       LEFT JOIN loyalty.transactions t ON t.user_id = a.user_id
      GROUP BY a.user_id, a.tier`,
  );

  let demoted = 0;

  for (const row of rows) {
    const currentTier = row.tier as LoyaltyTier;
    const recent = Number(row.recent_points);
    const computedTier = getTier(recent);

    // Downgrade only — nikdy upgrade (upgrade se děje v earnPoints)
    const tierOrder: LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];
    if (tierOrder.indexOf(computedTier) >= tierOrder.indexOf(currentTier)) {
      continue;
    }

    await deps.db.execute(
      `UPDATE loyalty.accounts SET tier = $1 WHERE user_id = $2`,
      [computedTier, row.user_id],
    );

    deps.kafka
      .send('loyalty.tier.changed', {
        userId: row.user_id,
        previousTier: currentTier,
        newTier: computedTier,
        reason: 'recompute_90d_downgrade',
        timestamp: new Date().toISOString(),
      })
      .catch(() => {
        /* best-effort */
      });

    demoted++;
  }

  return { scanned: rows.length, demoted };
}
