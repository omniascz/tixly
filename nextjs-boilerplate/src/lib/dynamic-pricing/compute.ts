/**
 * Dynamic pricing computation.
 *
 * Inspirováno airline pricing — multiplier roste s:
 *   1. velocity (orders/hour) — vysoké demand = vyšší cena
 *   2. scarcity (low remaining_qty) — málo lístků = vyšší cena
 *
 * Bound: nikdy přes max_uplift_pct + max_price_minor.
 *
 * Vrací { final_price, signals }.
 */
import { db } from "@/lib/db/rls-pool";



interface PricingRule {
  ticket_type_id: string;
  enabled: boolean;
  min_price_minor: number;
  max_price_minor: number;
  velocity_threshold_per_hour: number;
  max_uplift_pct: number;
  scarcity_threshold_pct: number;
  scarcity_uplift_pct: number;
  base_price: number;
  total_qty: number | null;
  remaining_qty: number | null;
}

export interface PricingResult {
  basePriceMinor: number;
  finalPriceMinor: number;
  upliftPct: number;
  signals: {
    velocityPerHour: number;
    scarcityPct: number;
    velocityUpliftPct: number;
    scarcityUpliftPct: number;
    enabled: boolean;
  };
}

export async function computeDynamicPrice(ticketTypeId: string): Promise<PricingResult> {
  const r = await db().query<PricingRule>(
    `SELECT dpr.ticket_type_id, dpr.enabled, dpr.min_price_minor, dpr.max_price_minor,
            dpr.velocity_threshold_per_hour, dpr.max_uplift_pct,
            dpr.scarcity_threshold_pct, dpr.scarcity_uplift_pct,
            tt.base_price, tt.total_qty, tt.remaining_qty
     FROM catalog.dynamic_pricing_rules dpr
     JOIN catalog.ticket_types tt ON tt.id = dpr.ticket_type_id
     WHERE dpr.ticket_type_id = $1`,
    [ticketTypeId],
  );

  if (r.rows.length === 0 || !r.rows[0].enabled) {
    // Žádné rule nebo disabled → vrátí base price
    const tt = await db().query<{ base_price: number }>(
      `SELECT base_price FROM catalog.ticket_types WHERE id = $1`,
      [ticketTypeId],
    );
    const basePrice = tt.rows[0]?.base_price ?? 0;
    return {
      basePriceMinor: basePrice,
      finalPriceMinor: basePrice,
      upliftPct: 0,
      signals: {
        velocityPerHour: 0,
        scarcityPct: 0,
        velocityUpliftPct: 0,
        scarcityUpliftPct: 0,
        enabled: false,
      },
    };
  }

  const rule = r.rows[0];

  // Velocity: orders za poslední 1h
  const velocityRes = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM orders.order_items oi
     JOIN orders.orders o ON o.id = oi.order_id
     WHERE oi.ticket_type_id = $1
       AND o.status IN ('paid', 'paid_partial', 'pending')
       AND o.created_at > NOW() - INTERVAL '1 hour'`,
    [ticketTypeId],
  );
  const velocityPerHour = Number(velocityRes.rows[0]?.count ?? 0);

  // Scarcity: % zbývajících
  let scarcityPct = 100;
  if (rule.total_qty !== null && rule.total_qty > 0 && rule.remaining_qty !== null) {
    scarcityPct = (rule.remaining_qty / rule.total_qty) * 100;
  }

  // Velocity uplift: linear od 0 do max_uplift_pct, scale 0..2× threshold
  const velocityRatio = Math.min(2, velocityPerHour / Math.max(1, rule.velocity_threshold_per_hour));
  const velocityUpliftPct = Math.round((velocityRatio / 2) * rule.max_uplift_pct);

  // Scarcity uplift: aplikuje se pokud scarcity_pct < scarcity_threshold_pct
  let scarcityUpliftPct = 0;
  if (scarcityPct < rule.scarcity_threshold_pct) {
    const remainingFactor = 1 - scarcityPct / rule.scarcity_threshold_pct;
    scarcityUpliftPct = Math.round(remainingFactor * rule.scarcity_uplift_pct);
  }

  // Combined uplift, capped at max_uplift_pct
  const totalUpliftPct = Math.min(
    rule.max_uplift_pct,
    velocityUpliftPct + scarcityUpliftPct,
  );

  let finalPrice = rule.base_price + Math.floor((rule.base_price * totalUpliftPct) / 100);
  finalPrice = Math.max(rule.min_price_minor, Math.min(rule.max_price_minor, finalPrice));

  return {
    basePriceMinor: rule.base_price,
    finalPriceMinor: finalPrice,
    upliftPct: totalUpliftPct,
    signals: {
      velocityPerHour,
      scarcityPct: Math.round(scarcityPct),
      velocityUpliftPct,
      scarcityUpliftPct,
      enabled: true,
    },
  };
}

/**
 * Apply computed price to ticket_types.dynamic_price_minor cache.
 */
export async function refreshDynamicPrice(ticketTypeId: string): Promise<PricingResult> {
  const result = await computeDynamicPrice(ticketTypeId);
  await db().query(
    `UPDATE catalog.ticket_types
     SET dynamic_price_minor = $2, dynamic_price_updated_at = NOW(),
         dynamic_price_signals = $3::jsonb
     WHERE id = $1`,
    [ticketTypeId, result.finalPriceMinor, JSON.stringify(result.signals)],
  );
  return result;
}
