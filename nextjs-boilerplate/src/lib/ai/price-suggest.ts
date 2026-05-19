/**
 * AI auto-pricing suggestions.
 *
 * Strategy: analyzuje historic events stejné kategorie, podobné kapacity,
 * stejného nebo podobného venue. Vrátí doporučenou cenu + confidence + reasoning.
 *
 * Algoritmus:
 *   1. Najdi top-N podobné past events (paid + paid_partial orders)
 *   2. Spočítej median, p25/p75 base_price
 *   3. Spočítej sell-through rate (sold/total)
 *   4. Doporučí median, případně upraveno podle sell-through (rychlý sell-out → vyšší)
 */

import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export interface PriceSuggestionInput {
  category: string;
  venueId?: string | null;
  estimatedCapacity: number;
  promoterId?: string;
}

export interface PriceSuggestion {
  suggestedPriceMinor: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  comparablesCount: number;
  medianPriceMinor: number;
  p25PriceMinor: number;
  p75PriceMinor: number;
  avgSellThroughPct: number;
  examples: { eventTitle: string; basePrice: number; sellThrough: number; date: string }[];
}

export async function suggestPrice(input: PriceSuggestionInput): Promise<PriceSuggestion> {
  // Najdi past events (paid + paid_partial), stejné category, bonus pokud stejný venue
  const args: unknown[] = [input.category];
  let venueClause = '';
  if (input.venueId) {
    args.push(input.venueId);
    venueClause = ` AND (e.venue_id = $${args.length} OR e.venue_id IS NULL)`;
  }
  const promoterBonus = input.promoterId ? `(CASE WHEN e.promoter_id = '${input.promoterId.replace(/'/g, "''")}' THEN 1 ELSE 0 END)` : '0';

  const r = await db().query<{
    event_id: string;
    event_title: string;
    base_price: number;
    total_qty: number | null;
    sold_qty: string;
    date_start: string;
    same_venue: boolean;
    same_promoter: number;
  }>(
    `SELECT e.id AS event_id, e.title AS event_title,
            tt.base_price, tt.total_qty,
            COALESCE((tt.total_qty - tt.remaining_qty), 0)::text AS sold_qty,
            e.date_start,
            (e.venue_id = $${input.venueId ? '2' : 'NULL'}) AS same_venue,
            ${promoterBonus} AS same_promoter
     FROM catalog.events e
     JOIN catalog.ticket_types tt ON tt.event_id = e.id
     WHERE e.category = $1 ${venueClause}
       AND e.date_start < NOW()
       AND e.status = 'published'
       AND tt.total_qty IS NOT NULL AND tt.total_qty > 0
       AND EXISTS (SELECT 1 FROM orders.orders o
                   WHERE o.event_id = e.id AND o.status IN ('paid','paid_partial'))
     ORDER BY same_venue DESC, same_promoter DESC, e.date_start DESC
     LIMIT 30`,
    args,
  );

  if (r.rows.length === 0) {
    return {
      suggestedPriceMinor: 50_000, // fallback 500 Kč
      confidence: 'low',
      reasoning: `Žádné porovnatelné akce v kategorii "${input.category}". Doporučujeme základní cenu 500 Kč jako startovací bod.`,
      comparablesCount: 0,
      medianPriceMinor: 0,
      p25PriceMinor: 0,
      p75PriceMinor: 0,
      avgSellThroughPct: 0,
      examples: [],
    };
  }

  const prices = r.rows.map((row) => row.base_price).sort((a, b) => a - b);
  const n = prices.length;
  const median = n % 2 === 0 ? (prices[n / 2 - 1] + prices[n / 2]) / 2 : prices[Math.floor(n / 2)];
  const p25 = prices[Math.floor(n * 0.25)] ?? median;
  const p75 = prices[Math.floor(n * 0.75)] ?? median;

  // Avg sell-through
  let totalSold = 0;
  let totalCapacity = 0;
  for (const row of r.rows) {
    if (row.total_qty) {
      totalSold += Number(row.sold_qty);
      totalCapacity += row.total_qty;
    }
  }
  const avgSellThroughPct = totalCapacity > 0 ? (totalSold / totalCapacity) * 100 : 0;

  // Pokud avg sell-through > 80%, demand byl vyšší než nabídka → můžeme zvýšit cenu k p75
  // Pokud < 50%, naopak doporučíme p25 (nebo nižší)
  let suggestedPriceMinor: number;
  let priceReason: string;
  if (avgSellThroughPct > 80) {
    suggestedPriceMinor = Math.round(p75);
    priceReason = `Vysoký avg sell-through (${avgSellThroughPct.toFixed(0)}%) — demand překročil nabídku. Doporučujeme p75 (${(p75 / 100).toFixed(0)} Kč), můžeš zkusit i víc.`;
  } else if (avgSellThroughPct < 50) {
    suggestedPriceMinor = Math.round(p25);
    priceReason = `Nízký avg sell-through (${avgSellThroughPct.toFixed(0)}%) — demand byl slabší. Doporučujeme p25 (${(p25 / 100).toFixed(0)} Kč) pro lepší konverzi.`;
  } else {
    suggestedPriceMinor = Math.round(median);
    priceReason = `Solidní avg sell-through (${avgSellThroughPct.toFixed(0)}%). Doporučujeme median ${(median / 100).toFixed(0)} Kč.`;
  }

  const confidence: PriceSuggestion['confidence'] =
    n >= 10 ? 'high' : n >= 5 ? 'medium' : 'low';
  const venueNote = input.venueId
    ? r.rows.filter((row) => row.same_venue).length > 0
      ? ` Některé z porovnávaných akcí byly přímo v tomto sále.`
      : ''
    : '';

  return {
    suggestedPriceMinor,
    confidence,
    reasoning: `${priceReason}${venueNote} Analýza nad ${n} podobnými akcemi v kategorii "${input.category}" (rozsah ${(p25 / 100).toFixed(0)}–${(p75 / 100).toFixed(0)} Kč).`,
    comparablesCount: n,
    medianPriceMinor: Math.round(median),
    p25PriceMinor: Math.round(p25),
    p75PriceMinor: Math.round(p75),
    avgSellThroughPct: Math.round(avgSellThroughPct),
    examples: r.rows.slice(0, 5).map((row) => ({
      eventTitle: row.event_title,
      basePrice: row.base_price,
      sellThrough: row.total_qty
        ? Math.round((Number(row.sold_qty) / row.total_qty) * 100)
        : 0,
      date: row.date_start,
    })),
  };
}
