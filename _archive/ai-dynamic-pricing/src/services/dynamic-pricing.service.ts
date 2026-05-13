/**
 * dynamic-pricing.service.ts — orchestrace dynamického cenotvorby.
 * Propojuje sběr signálů, cenotvorbu a persistenci pravidel.
 */

import type {
  PricingRule,
  PriceRecommendation,
} from '../types/pricing.js';
import { DEFAULT_PRICING_RULE } from '../types/pricing.js';
import { collectDemandSignals } from '../lib/demand-analyzer.js';
import { computeRecommendedPrice } from '../lib/price-engine.js';
import type { DbAdapter } from '@tixly/rls-multitenancy';
import { withTenantContext } from '@tixly/rls-multitenancy';

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface ServiceDeps {
  db: DbAdapter;
}

// ─── DB row types ────────────────────────────────────────────────────────────

interface RuleRow {
  strategy: string;
  min_price_halire: number;
  max_price_halire: number;
  early_bird_discount_pct: number;
  early_bird_threshold_pct: number;
  surge_multiplier: number;
  surge_velocity_threshold: number;
  time_decay_start_days: number;
  time_decay_max_increase_pct: number;
}

interface TicketTypeIdRow {
  id: string;
}

// ─── getRule ─────────────────────────────────────────────────────────────────

export async function getRule(
  eventId: string,
  ticketTypeId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<PricingRule> {
  const result = await withTenantContext(deps.db, promoterId, (client) =>
    client.query<RuleRow>(
      `SELECT
         strategy,
         min_price_halire,
         max_price_halire,
         early_bird_discount_pct,
         early_bird_threshold_pct,
         surge_multiplier,
         surge_velocity_threshold,
         time_decay_start_days,
         time_decay_max_increase_pct
       FROM pricing.rules
       WHERE event_id = $1 AND ticket_type_id = $2
       LIMIT 1`,
      [eventId, ticketTypeId],
    ),
  );

  if (result.rows.length === 0) {
    return { ...DEFAULT_PRICING_RULE };
  }

  const row = result.rows[0];
  return {
    strategy: row.strategy as PricingRule['strategy'],
    minPriceHalire: row.min_price_halire,
    maxPriceHalire: row.max_price_halire,
    earlyBirdDiscountPct: row.early_bird_discount_pct,
    earlyBirdThresholdPct: row.early_bird_threshold_pct,
    surgeMultiplier: row.surge_multiplier,
    surgeVelocityThreshold: row.surge_velocity_threshold,
    timeDecayStartDays: row.time_decay_start_days,
    timeDecayMaxIncreasePct: row.time_decay_max_increase_pct,
  };
}

// ─── setRule ─────────────────────────────────────────────────────────────────

export async function setRule(
  eventId: string,
  ticketTypeId: string,
  promoterId: string,
  rulePartial: Partial<PricingRule>,
  deps: ServiceDeps,
): Promise<PricingRule> {
  const current = await getRule(eventId, ticketTypeId, promoterId, deps);
  const merged: PricingRule = { ...current, ...rulePartial };

  await withTenantContext(deps.db, promoterId, (client) =>
    client.query(
      `INSERT INTO pricing.rules (
         event_id, ticket_type_id, promoter_id,
         strategy, min_price_halire, max_price_halire,
         early_bird_discount_pct, early_bird_threshold_pct,
         surge_multiplier, surge_velocity_threshold,
         time_decay_start_days, time_decay_max_increase_pct,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
       ON CONFLICT (event_id, ticket_type_id) DO UPDATE SET
         strategy = EXCLUDED.strategy,
         min_price_halire = EXCLUDED.min_price_halire,
         max_price_halire = EXCLUDED.max_price_halire,
         early_bird_discount_pct = EXCLUDED.early_bird_discount_pct,
         early_bird_threshold_pct = EXCLUDED.early_bird_threshold_pct,
         surge_multiplier = EXCLUDED.surge_multiplier,
         surge_velocity_threshold = EXCLUDED.surge_velocity_threshold,
         time_decay_start_days = EXCLUDED.time_decay_start_days,
         time_decay_max_increase_pct = EXCLUDED.time_decay_max_increase_pct,
         updated_at = NOW()`,
      [
        eventId,
        ticketTypeId,
        promoterId,
        merged.strategy,
        merged.minPriceHalire,
        merged.maxPriceHalire,
        merged.earlyBirdDiscountPct,
        merged.earlyBirdThresholdPct,
        merged.surgeMultiplier,
        merged.surgeVelocityThreshold,
        merged.timeDecayStartDays,
        merged.timeDecayMaxIncreasePct,
      ],
    ),
  );

  return merged;
}

// ─── getRecommendation ───────────────────────────────────────────────────────

export async function getRecommendation(
  eventId: string,
  ticketTypeId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<PriceRecommendation> {
  const [signals, rule] = await Promise.all([
    collectDemandSignals(eventId, ticketTypeId, promoterId, deps.db),
    getRule(eventId, ticketTypeId, promoterId, deps),
  ]);

  return computeRecommendedPrice(signals, rule);
}

// ─── autoAdjustPrices ────────────────────────────────────────────────────────

export async function autoAdjustPrices(
  eventId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<{ adjusted: number; skipped: number }> {
  // Get all ticket types for the event
  const ticketTypes = await withTenantContext(deps.db, promoterId, (client) =>
    client.query<TicketTypeIdRow>(
      `SELECT id FROM catalog.ticket_types WHERE event_id = $1`,
      [eventId],
    ),
  );

  let adjusted = 0;
  let skipped = 0;

  for (const tt of ticketTypes.rows) {
    try {
      const recommendation = await getRecommendation(eventId, tt.id, promoterId, deps);

      if (recommendation.shouldAutoApply && recommendation.deltaHalire !== 0) {
        // Update price
        await withTenantContext(deps.db, promoterId, (client) =>
          client.query(
            `UPDATE catalog.ticket_types
             SET current_price_halire = $1
             WHERE id = $2 AND event_id = $3`,
            [recommendation.recommendedPriceHalire, tt.id, eventId],
          ),
        );

        // Log to price history
        await withTenantContext(deps.db, promoterId, (client) =>
          client.query(
            `INSERT INTO pricing.price_history (
               event_id, ticket_type_id, promoter_id,
               old_price_halire, new_price_halire,
               strategy, reasons, confidence,
               applied_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
              eventId,
              tt.id,
              promoterId,
              recommendation.currentPriceHalire,
              recommendation.recommendedPriceHalire,
              recommendation.strategy,
              JSON.stringify(recommendation.reasons),
              recommendation.confidence,
            ],
          ),
        );

        adjusted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(
        `[autoAdjustPrices] Chyba při úpravě ceny pro ticketTypeId=${tt.id}:`,
        err,
      );
      skipped++;
    }
  }

  return { adjusted, skipped };
}
