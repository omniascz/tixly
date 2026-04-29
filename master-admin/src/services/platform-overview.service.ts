import type { DbAdapter, PlatformOverview } from '../lib/types.js';

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface TenantStatusRow {
  status: string;
  cnt: string;
}

interface OrderStatsRow {
  total_revenue: string | null;
  total_orders: string | null;
  total_tickets: string | null;
}

interface TopTenantRow {
  tenant_id: string;
  name: string;
  revenue: string;
}

interface DailyRevenueRow {
  date: string;
  revenue: string | null;
  orders: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIntSafe(val: string | null | undefined, fallback = 0): number {
  if (val === null || val === undefined) return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : n;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Vrátí dashboard statistiky celé platformy.
 */
export async function getPlatformOverview(db: DbAdapter): Promise<PlatformOverview> {
  const [statusRows, orderRows, topTenantRows, dailyRows] = await Promise.all([
    db.query<TenantStatusRow>(
      `SELECT status, COUNT(*)::TEXT AS cnt
       FROM platform.promoters
       GROUP BY status`,
    ),
    db.query<OrderStatsRow>(
      `SELECT
         COALESCE(SUM(o.total_amount), 0)::TEXT AS total_revenue,
         COUNT(o.id)::TEXT AS total_orders,
         COALESCE(SUM(oi.quantity), 0)::TEXT AS total_tickets
       FROM orders.orders o
       LEFT JOIN orders.order_items oi ON oi.order_id = o.id
       WHERE o.created_at > NOW() - INTERVAL '30 days'
         AND o.status = 'paid'`,
    ),
    db.query<TopTenantRow>(
      `SELECT
         p.id AS tenant_id,
         p.name,
         COALESCE(SUM(o.total_amount), 0)::TEXT AS revenue
       FROM platform.promoters p
       LEFT JOIN orders.orders o ON o.promoter_id = p.id
         AND o.status = 'paid'
         AND o.created_at > NOW() - INTERVAL '30 days'
       GROUP BY p.id, p.name
       ORDER BY revenue DESC
       LIMIT 10`,
    ),
    db.query<DailyRevenueRow>(
      `SELECT
         DATE(created_at)::TEXT AS date,
         COALESCE(SUM(total_amount), 0)::TEXT AS revenue,
         COUNT(id)::TEXT AS orders
       FROM orders.orders
       WHERE created_at > NOW() - INTERVAL '30 days'
         AND status = 'paid'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
    ),
  ]);

  const statusMap = new Map(statusRows.map((r) => [r.status, parseIntSafe(r.cnt)]));
  const totalTenants = [...statusMap.values()].reduce((a, b) => a + b, 0);

  return {
    totalTenants,
    activeTenants: statusMap.get('active') ?? 0,
    suspendedTenants: statusMap.get('suspended') ?? 0,
    totalRevenue30d: parseIntSafe(orderRows[0]?.total_revenue),
    totalOrders30d: parseIntSafe(orderRows[0]?.total_orders),
    totalTickets30d: parseIntSafe(orderRows[0]?.total_tickets),
    topTenantsByRevenue: topTenantRows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      revenue: parseIntSafe(r.revenue),
    })),
    revenueByDay: dailyRows.map((r) => ({
      date: r.date,
      revenue: parseIntSafe(r.revenue),
      orders: parseIntSafe(r.orders),
    })),
  };
}

/**
 * Vrátí denní statistiky příjmů za posledních N dní.
 */
export async function getRevenueStats(
  days: number,
  db: DbAdapter,
): Promise<Array<{ date: string; revenue: number; orders: number }>> {
  const rows = await db.query<DailyRevenueRow>(
    `SELECT
       DATE(created_at)::TEXT AS date,
       COALESCE(SUM(total_amount), 0)::TEXT AS revenue,
       COUNT(id)::TEXT AS orders
     FROM orders.orders
     WHERE created_at > NOW() - ($1 || ' days')::INTERVAL
       AND status = 'paid'
     GROUP BY DATE(created_at)
     ORDER BY date DESC
     LIMIT $1`,
    [days],
  );

  return rows.map((r) => ({
    date: r.date,
    revenue: parseIntSafe(r.revenue),
    orders: parseIntSafe(r.orders),
  }));
}
