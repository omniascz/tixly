import { NextRequest, NextResponse } from 'next/server'
import { requireReseller } from '@/lib/reseller-auth'
import { db, runWithServiceContext } from '@/lib/db/rls-pool'

export const dynamic = 'force-dynamic'

interface StatsRow {
  total_sales: string
  total_revenue_halire: string | null
  total_commission_halire: string | null
  pending_commission_halire: string | null
  sales_last_30d: string
}

interface SaleRow {
  created_at: string
  total_amount: number
  commission_amount_halire: number
  settled_at: string | null
  event_title: string
  qty: string
}

export async function GET(req: NextRequest): Promise<Response> {
  let session
  try {
    session = await requireReseller(req)
  } catch (e) {
    return e as Response
  }

  return runWithServiceContext(async () => {
  const statsRes = await db().query<StatsRow>(
    `SELECT
       COUNT(rs.id) AS total_sales,
       SUM(o.total_amount) AS total_revenue_halire,
       SUM(rs.commission_amount_halire) AS total_commission_halire,
       SUM(rs.commission_amount_halire) FILTER (WHERE rs.settled_at IS NULL) AS pending_commission_halire,
       COUNT(rs.id) FILTER (WHERE rs.created_at > NOW() - INTERVAL '30 days') AS sales_last_30d
     FROM orders.reseller_sales rs
     JOIN orders.orders o ON o.id = rs.order_id
     WHERE rs.partner_id = $1`,
    [session.partnerId],
  )

  const salesRes = await db().query<SaleRow>(
    `SELECT rs.created_at, o.total_amount, rs.commission_amount_halire, rs.settled_at,
            oi_agg.event_title, oi_agg.qty
     FROM orders.reseller_sales rs
     JOIN orders.orders o ON o.id = rs.order_id
     JOIN (
       SELECT oi.order_id, e.title AS event_title, SUM(oi.quantity) AS qty
       FROM orders.order_items oi
       JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
       JOIN catalog.events e ON e.id = tt.event_id
       GROUP BY oi.order_id, e.title
     ) oi_agg ON oi_agg.order_id = rs.order_id
     WHERE rs.partner_id = $1
     ORDER BY rs.created_at DESC LIMIT 20`,
    [session.partnerId],
  )

  const stats = statsRes.rows[0] ?? {
    total_sales: '0',
    total_revenue_halire: null,
    total_commission_halire: null,
    pending_commission_halire: null,
    sales_last_30d: '0',
  }

  return NextResponse.json({
    stats: {
      totalSales: Number(stats.total_sales),
      totalRevenueHalire: Number(stats.total_revenue_halire ?? 0),
      totalCommissionHalire: Number(stats.total_commission_halire ?? 0),
      pendingCommissionHalire: Number(stats.pending_commission_halire ?? 0),
      salesLast30d: Number(stats.sales_last_30d),
    },
    recentSales: salesRes.rows,
  })
  }) // end runWithServiceContext
}
