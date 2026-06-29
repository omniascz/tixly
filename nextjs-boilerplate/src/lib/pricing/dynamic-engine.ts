/**
 * Dynamic pricing engine — demand score + rule evaluation.
 *
 * Demand score (0–1):
 *   0.50 * capacity fill %
 *   0.30 * velocity score (tickets/24h vs expected daily rate)
 *   0.20 * time pressure (inverse of days remaining, 0=far, 1=now)
 *
 * Aktuální cena = dynamic_price_minor (pokud nastaveno) JINAK base_price.
 * Engine zapisuje do dynamic_price_minor + dynamic_price_updated_at.
 */

import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export interface DemandMetrics {
  capacity_total: number;
  capacity_sold: number;
  capacity_pct: number;
  velocity_24h: number;
  hours_to_event: number;
  days_to_event: number;
  demand_score: number;
}

export interface PriceAdjustment {
  new_price_halire: number;
  old_price_halire: number;
  price_diff_pct: number;
  trigger_reason: string;
  rule_id: string | null;
  demand_score: number;
}

interface DPRule {
  id: string;
  rule_type: string;
  trigger_condition: Record<string, number>;
  price_adjustment: { type: string; value: number };
  applies_to: string;
  max_price_multiplier: number;
  min_price_multiplier: number;
  priority: number;
}

interface TicketTypeDP {
  id: string;
  name: string;
  base_price: number;
  dynamic_price_minor: number | null;
  dp_min_halire: number | null;
  dp_max_halire: number | null;
  remaining_qty: number | null;
  total_qty: number | null;
  dynamic_pricing_enabled: boolean;
}

function currentPrice(tt: TicketTypeDP): number {
  return tt.dynamic_price_minor != null ? tt.dynamic_price_minor : tt.base_price;
}

export async function computeDemandMetrics(eventId: string): Promise<DemandMetrics> {
  const r = await runWithServiceContext(() =>
    db().query(
      `SELECT
         COALESCE(SUM(tt.total_qty), 0)::int AS capacity_total,
         (SELECT COUNT(*)::int FROM tickets.tickets t
           JOIN orders.orders o ON o.id = t.order_id
           WHERE o.event_id = $1 AND o.status = 'paid') AS capacity_sold,
         (SELECT COUNT(*)::int FROM tickets.tickets t
           JOIN orders.orders o ON o.id = t.order_id
           WHERE o.event_id = $1 AND o.status = 'paid'
             AND o.paid_at > NOW() - INTERVAL '24 hours') AS velocity_24h,
         GREATEST(0, EXTRACT(EPOCH FROM (e.date_start - NOW())) / 3600)::int AS hours_to_event
       FROM catalog.events e
       LEFT JOIN catalog.ticket_types tt ON tt.event_id = e.id
       WHERE e.id = $1
       GROUP BY e.date_start`,
      [eventId],
    ),
  );

  if (r.rows.length === 0) {
    return { capacity_total: 0, capacity_sold: 0, capacity_pct: 0, velocity_24h: 0, hours_to_event: 9999, days_to_event: 999, demand_score: 0 };
  }

  const row = r.rows[0] as {
    capacity_total: number;
    capacity_sold: number;
    velocity_24h: number;
    hours_to_event: number;
  };

  const capacity_pct = row.capacity_total > 0 ? row.capacity_sold / row.capacity_total : 0;
  const days_to_event = row.hours_to_event / 24;

  const expected_daily = row.capacity_total > 0 ? row.capacity_total / 30 : 1;
  const velocity_score = Math.min(1, row.velocity_24h / Math.max(1, expected_daily));
  const time_pressure  = Math.max(0, Math.min(1, 1 - (days_to_event / 30)));

  const demand_score = Math.min(1,
    capacity_pct   * 0.50 +
    velocity_score * 0.30 +
    time_pressure  * 0.20,
  );

  return {
    capacity_total: row.capacity_total,
    capacity_sold:  row.capacity_sold,
    capacity_pct,
    velocity_24h:   row.velocity_24h,
    hours_to_event: row.hours_to_event,
    days_to_event,
    demand_score:   Math.round(demand_score * 10000) / 10000,
  };
}

export function evaluateRules(
  rules: DPRule[],
  metrics: DemandMetrics,
  ticketType: TicketTypeDP,
): PriceAdjustment | null {
  const cur      = currentPrice(ticketType);
  const base     = ticketType.base_price;
  const minPrice = ticketType.dp_min_halire ?? Math.round(base * 0.50);
  const maxPrice = ticketType.dp_max_halire ?? Math.round(base * 2.00);

  const sorted = [...rules]
    .filter((r) => r.applies_to === 'all' || r.applies_to === ticketType.id)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sorted) {
    if (!ruleMatches(rule, metrics)) continue;

    const newPrice = applyAdjustment(
      rule.price_adjustment, cur, base, minPrice, maxPrice,
      rule.max_price_multiplier, rule.min_price_multiplier,
    );
    if (newPrice === cur) continue;

    const diffPct = ((newPrice - cur) / cur) * 100;

    return {
      new_price_halire: newPrice,
      old_price_halire: cur,
      price_diff_pct:   Math.round(diffPct * 100) / 100,
      trigger_reason:   buildReason(rule, metrics),
      rule_id:          rule.id,
      demand_score:     metrics.demand_score,
    };
  }

  return null;
}

function ruleMatches(rule: DPRule, m: DemandMetrics): boolean {
  const c = rule.trigger_condition;
  switch (rule.rule_type) {
    case 'capacity_threshold':
      return typeof c.capacity_pct === 'number' && m.capacity_pct >= c.capacity_pct;
    case 'time_decay':
      return typeof c.hours_before === 'number' && m.hours_to_event <= c.hours_before;
    case 'last_minute':
      return m.hours_to_event <= 48;
    case 'early_bird':
      return typeof c.days_before === 'number' && m.days_to_event >= c.days_before;
    case 'velocity_surge':
      return typeof c.tickets_per_24h === 'number' && m.velocity_24h >= c.tickets_per_24h;
    default:
      return false;
  }
}

function applyAdjustment(
  adj: { type: string; value: number },
  currentPriceH: number,
  basePriceH: number,
  minPrice: number,
  maxPrice: number,
  maxMultiplier: number,
  minMultiplier: number,
): number {
  let newPrice: number;

  if (adj.type === 'pct_increase') {
    newPrice = Math.round(currentPriceH * (1 + adj.value / 100));
  } else if (adj.type === 'pct_decrease') {
    newPrice = Math.round(currentPriceH * (1 - adj.value / 100));
  } else if (adj.type === 'set_pct_of_base') {
    newPrice = Math.round(basePriceH * (adj.value / 100));
  } else {
    return currentPriceH;
  }

  const absMax = Math.min(maxPrice, Math.round(basePriceH * maxMultiplier));
  const absMin = Math.max(minPrice, Math.round(basePriceH * minMultiplier));

  return Math.max(absMin, Math.min(absMax, newPrice));
}

function buildReason(rule: DPRule, m: DemandMetrics): string {
  const adj = rule.price_adjustment;
  const adjStr = adj.type === 'pct_increase' ? `+${adj.value}%` : `-${adj.value}%`;

  switch (rule.rule_type) {
    case 'capacity_threshold':
      return `Kapacita ${Math.round(m.capacity_pct * 100)}% prodána → ${adjStr}`;
    case 'time_decay':
    case 'last_minute':
      return `${m.hours_to_event}h před akcí → ${adjStr}`;
    case 'early_bird':
      return `Včasný nákup (${Math.round(m.days_to_event)} dní) → ${adjStr}`;
    case 'velocity_surge':
      return `Rychlost prodeje ${m.velocity_24h} lístků/24h → ${adjStr}`;
    default:
      return `Pravidlo ${rule.rule_type} → ${adjStr}`;
  }
}

export async function recalculateEvent(eventId: string): Promise<{ updated: number; metrics: DemandMetrics }> {
  const metrics = await computeDemandMetrics(eventId);

  const rulesR = await runWithServiceContext(() =>
    db().query(
      `SELECT id, rule_type, trigger_condition, price_adjustment,
              applies_to, max_price_multiplier, min_price_multiplier, priority
       FROM pricing.dynamic_pricing_rules
       WHERE event_id = $1 AND is_active = true
       ORDER BY priority DESC`,
      [eventId],
    ),
  );

  const rules = rulesR.rows as DPRule[];
  if (rules.length === 0) return { updated: 0, metrics };

  const ttR = await runWithServiceContext(() =>
    db().query(
      `SELECT id, name, base_price, dynamic_price_minor, dp_min_halire, dp_max_halire,
              remaining_qty, total_qty, dynamic_pricing_enabled
       FROM catalog.ticket_types
       WHERE event_id = $1 AND dynamic_pricing_enabled = true`,
      [eventId],
    ),
  );

  let updated = 0;

  for (const tt of ttR.rows as TicketTypeDP[]) {
    const adjustment = evaluateRules(rules, metrics, tt);
    if (!adjustment) continue;

    await runWithServiceContext(() =>
      db().query(
        `UPDATE catalog.ticket_types
         SET dynamic_price_minor = $1,
             dynamic_price_updated_at = NOW(),
             dynamic_price_signals = $2::jsonb
         WHERE id = $3`,
        [
          adjustment.new_price_halire,
          JSON.stringify({
            demand_score: metrics.demand_score,
            capacity_pct: metrics.capacity_pct,
            velocity_24h: metrics.velocity_24h,
            hours_to_event: metrics.hours_to_event,
            trigger: adjustment.trigger_reason,
          }),
          tt.id,
        ],
      ),
    );

    await runWithServiceContext(() =>
      db().query(
        `INSERT INTO pricing.price_adjustment_log
           (event_id, ticket_type_id, rule_id, old_price_halire, new_price_halire,
            price_diff_pct, trigger_reason, demand_score, capacity_pct, velocity_24h, hours_to_event)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          eventId, tt.id, adjustment.rule_id,
          adjustment.old_price_halire, adjustment.new_price_halire,
          adjustment.price_diff_pct, adjustment.trigger_reason,
          adjustment.demand_score, metrics.capacity_pct, metrics.velocity_24h, metrics.hours_to_event,
        ],
      ),
    );

    if (adjustment.rule_id) {
      await runWithServiceContext(() =>
        db().query(
          `UPDATE pricing.dynamic_pricing_rules
           SET applied_count = applied_count + 1, last_applied_at = NOW()
           WHERE id = $1`,
          [adjustment.rule_id],
        ),
      );
    }

    updated++;
  }

  return { updated, metrics };
}

export function getDemandBadge(metrics: DemandMetrics): { label: string; color: string } | null {
  if (metrics.hours_to_event <= 6)   return { label: '⚡ Posledních pár hodin', color: 'red' };
  if (metrics.hours_to_event <= 48)  return { label: '🕐 Akce brzy začíná', color: 'amber' };
  if (metrics.capacity_pct >= 0.90)  return { label: '🔥 Skoro vyprodáno', color: 'red' };
  if (metrics.capacity_pct >= 0.75)  return { label: '📈 Zájem roste', color: 'amber' };
  if (metrics.demand_score >= 0.70)  return { label: '⚡ Rychle se prodává', color: 'amber' };
  if (metrics.velocity_24h >= 20)    return { label: '🔥 Velký zájem dnes', color: 'amber' };
  return null;
}
