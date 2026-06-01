/**
 * Pricing Rules Engine — vyhodnotí všechny aktivní pravidla pro ticket_type
 * a vrátí finální cenu + sources které ji ovlivnily.
 *
 * Order of operations:
 *   1. base_price (tt.base_price)
 *   2. Time-based pricing windows (priority desc, first match wins)
 *   3. Dynamic pricing (velocity + scarcity)
 *   4. A/B price test override (pokud session přiřazena do testu)
 *
 * Vrací { finalPrice, sources, signals }.
 * Caller potom INSERT do ticket_type_price_history s sources jako audit.
 */
import { computeDynamicPrice } from '@/lib/dynamic-pricing/compute';
import { db } from '@/lib/db/rls-pool';


export interface PriceSource {
  source: 'base' | 'pricing_window' | 'dynamic_pricing' | 'ab_test';
  description: string;
  appliedDelta: number;
  finalPrice: number;
}

export interface RulesEngineResult {
  ticketTypeId: string;
  basePrice: number;
  finalPrice: number;
  sources: PriceSource[];
}

export async function evaluatePricing(
  ticketTypeId: string,
  options?: { sessionHash?: string },
): Promise<RulesEngineResult> {
  const ttRes = await db().query<{ base_price: number }>(
    `SELECT base_price FROM catalog.ticket_types WHERE id = $1`,
    [ticketTypeId],
  );
  if (ttRes.rows.length === 0) {
    throw new Error('TICKET_TYPE_NOT_FOUND');
  }

  const basePrice = ttRes.rows[0].base_price;
  let currentPrice = basePrice;
  const sources: PriceSource[] = [
    {
      source: 'base',
      description: 'Base price',
      appliedDelta: 0,
      finalPrice: basePrice,
    },
  ];

  // 2. Time-based pricing window (highest priority, first match wins)
  const windowRes = await db().query<{
    id: string; name: string;
    price_override: number | null;
    price_change_pct: number | null;
  }>(
    `SELECT id, name, price_override, price_change_pct
       FROM catalog.pricing_windows
      WHERE ticket_type_id = $1
        AND enabled = true
        AND starts_at <= now() AND ends_at > now()
      ORDER BY priority DESC
      LIMIT 1`,
    [ticketTypeId],
  );

  if (windowRes.rows.length > 0) {
    const w = windowRes.rows[0];
    const newPrice = w.price_override !== null
      ? w.price_override
      : Math.round(currentPrice * (1 + (Number(w.price_change_pct ?? 0) / 100)));
    const delta = newPrice - currentPrice;
    currentPrice = newPrice;
    sources.push({
      source: 'pricing_window',
      description: w.name,
      appliedDelta: delta,
      finalPrice: currentPrice,
    });
  }

  // 3. Dynamic pricing (velocity + scarcity)
  try {
    const dyn = await computeDynamicPrice(ticketTypeId);
    if (dyn.signals.enabled && dyn.upliftPct > 0) {
      const newPrice = dyn.finalPriceMinor;
      const delta = newPrice - currentPrice;
      if (delta !== 0) {
        currentPrice = newPrice;
        sources.push({
          source: 'dynamic_pricing',
          description: `Velocity ${dyn.signals.velocityPerHour}/h, scarcity ${dyn.signals.scarcityPct}%`,
          appliedDelta: delta,
          finalPrice: currentPrice,
        });
      }
    }
  } catch {
    // dynamic_pricing_rules nemusí být configured — silent
  }

  // 4. A/B price test override
  if (options?.sessionHash) {
    const abRes = await db().query<{
      id: string;
      name: string;
      variant_a_price: number;
      variant_b_price: number;
      variant_b_pct: number;
    }>(
      `SELECT id, name, variant_a_price, variant_b_price, variant_b_pct
         FROM catalog.ab_price_tests
        WHERE ticket_type_id = $1
          AND status = 'active'
          AND starts_at <= now()
          AND (ends_at IS NULL OR ends_at > now())
        LIMIT 1`,
      [ticketTypeId],
    );

    if (abRes.rows.length > 0) {
      const test = abRes.rows[0];
      // Assignment: stable hash → variant
      const variant = hashToVariant(options.sessionHash, test.id, test.variant_b_pct);
      const variantPrice = variant === 'b' ? test.variant_b_price : test.variant_a_price;

      // Idempotent assignment record
      await db().query(
        `INSERT INTO catalog.ab_price_assignments (test_id, session_hash, variant, shown_price)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (test_id, session_hash) DO NOTHING`,
        [test.id, options.sessionHash, variant, variantPrice],
      );

      const delta = variantPrice - currentPrice;
      currentPrice = variantPrice;
      sources.push({
        source: 'ab_test',
        description: `${test.name} → variant ${variant.toUpperCase()}`,
        appliedDelta: delta,
        finalPrice: currentPrice,
      });
    }
  }

  return {
    ticketTypeId,
    basePrice,
    finalPrice: currentPrice,
    sources,
  };
}

function hashToVariant(sessionHash: string, testId: string, variantBPct: number): 'a' | 'b' {
  // Simple stable hash: sum char codes modulo 100
  const combined = sessionHash + testId;
  let sum = 0;
  for (let i = 0; i < combined.length; i++) sum = (sum * 31 + combined.charCodeAt(i)) >>> 0;
  return (sum % 100) < variantBPct ? 'b' : 'a';
}

/**
 * Apply final price na ticket_types + INSERT do price_history pokud se změnila.
 */
export async function applyPricing(
  ticketTypeId: string,
  result: RulesEngineResult,
  changedByUserId: string | null = null,
): Promise<{ changed: boolean }> {
  const cur = await db().query<{ base_price: number }>(
    `SELECT base_price FROM catalog.ticket_types WHERE id = $1`,
    [ticketTypeId],
  );
  if (cur.rows.length === 0) return { changed: false };

  if (cur.rows[0].base_price === result.finalPrice) {
    return { changed: false };
  }

  await db().query('BEGIN');
  try {
    await db().query(
      `UPDATE catalog.ticket_types SET base_price = $1 WHERE id = $2`,
      [result.finalPrice, ticketTypeId],
    );
    await db().query(
      `INSERT INTO catalog.ticket_type_price_history
         (ticket_type_id, old_price, new_price, change_source, change_reason, changed_by_user_id, signals)
       VALUES ($1, $2, $3, 'pricing_rule_engine', $4, $5, $6::jsonb)`,
      [
        ticketTypeId,
        cur.rows[0].base_price,
        result.finalPrice,
        result.sources.map((s) => s.description).join(' → '),
        changedByUserId,
        JSON.stringify(result.sources),
      ],
    );
    await db().query('COMMIT');
    return { changed: true };
  } catch (e) {
    await db().query('ROLLBACK');
    throw e;
  }
}
