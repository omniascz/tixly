/**
 * demand-analyzer.ts — sběr signálů poptávky z databáze.
 * Aggreguje aktuální stav prodeje, rychlost prodeje a časové údaje.
 */

import type { DemandSignals } from '../types/pricing.js';
import type { DbAdapter } from '@tixly/rls-multitenancy';
import { withTenantContext } from '@tixly/rls-multitenancy';

interface TicketTypeRow {
  current_price_halire: number;
  base_price_halire: number;
  sold_count: number;
  total_capacity: number;
  event_start_date: string;
}

interface VelocityRow {
  sales_1h: string;
  sales_24h: string;
  sales_7d: string;
}

export async function collectDemandSignals(
  eventId: string,
  ticketTypeId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<DemandSignals> {
  const [ticketResult, velocityResult] = await Promise.all([
    // Current state + event date
    withTenantContext(db, promoterId, (client) =>
      client.query<TicketTypeRow>(
        `SELECT
           tt.current_price_halire,
           tt.base_price_halire,
           COALESCE(tt.sold_count, 0) AS sold_count,
           tt.total_capacity,
           e.start_date AS event_start_date
         FROM catalog.ticket_types tt
         JOIN catalog.events e ON e.id = tt.event_id
         WHERE tt.id = $1 AND tt.event_id = $2
         LIMIT 1`,
        [ticketTypeId, eventId],
      ),
    ),
    // Sales velocity
    withTenantContext(db, promoterId, (client) =>
      client.query<VelocityRow>(
        `SELECT
           COALESCE(SUM(CASE WHEN oi.created_at >= NOW() - INTERVAL '1 hour' THEN oi.quantity ELSE 0 END), 0)::text AS sales_1h,
           COALESCE(SUM(CASE WHEN oi.created_at >= NOW() - INTERVAL '24 hours' THEN oi.quantity ELSE 0 END), 0)::text AS sales_24h,
           COALESCE(SUM(CASE WHEN oi.created_at >= NOW() - INTERVAL '7 days' THEN oi.quantity ELSE 0 END), 0)::text AS sales_7d
         FROM orders.order_items oi
         JOIN orders.orders o ON o.id = oi.order_id
         WHERE oi.ticket_type_id = $1 AND o.status = 'paid'`,
        [ticketTypeId],
      ),
    ),
  ]);

  if (ticketResult.rows.length === 0) {
    throw new Error(`Typ vstupenky nenalezen: ticketTypeId=${ticketTypeId}, eventId=${eventId}`);
  }

  const tt = ticketResult.rows[0];
  const vel = velocityResult.rows[0];

  const soldCount = tt.sold_count;
  const totalCapacity = tt.total_capacity;
  const soldPercentage = totalCapacity > 0 ? (soldCount / totalCapacity) * 100 : 0;

  const eventDate = new Date(tt.event_start_date);
  const now = new Date();
  const msUntilEvent = eventDate.getTime() - now.getTime();
  const hoursUntilEvent = Math.max(0, msUntilEvent / (1000 * 60 * 60));
  const daysUntilEvent = Math.max(0, msUntilEvent / (1000 * 60 * 60 * 24));

  const salesLast7d = parseInt(vel.sales_7d, 10);
  const avgDailySales7d = salesLast7d / 7;

  const dayOfWeek = now.getDay();

  return {
    eventId,
    ticketTypeId,
    currentPriceHalire: tt.current_price_halire,
    basePriceHalire: tt.base_price_halire,
    soldCount,
    totalCapacity,
    soldPercentage,
    salesLast1h: parseInt(vel.sales_1h, 10),
    salesLast24h: parseInt(vel.sales_24h, 10),
    salesLast7d: salesLast7d,
    avgDailySales7d,
    daysUntilEvent,
    hoursUntilEvent,
    competitorPriceHalire: null,
    weatherForecast: null,
    dayOfWeek,
    isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
  };
}
