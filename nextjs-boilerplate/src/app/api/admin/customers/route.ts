import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

interface CustomerRow {
  email: string;
  name: string | null;
  phone: string | null;
  historical_purchases: string | null;
  historical_spend_halire: string | null;
  import_source: string | null;
  opted_out: boolean;
  user_id: string | null;
  live_purchases: string;
  live_spend_halire: string;
  total_visits: string;
  total_ltv_halire: string;
  last_seen_at: string | null;
}

interface StatsRow {
  total_contacts: string;
  total_from_import: string;
  total_live_buyers: string;
  avg_ltv: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const url = req.nextUrl;
    const q = url.searchParams.get('q') ?? null;
    const sort = url.searchParams.get('sort') ?? 'ltv';
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = 50;
    const offset = (page - 1) * limit;

    const orderBy =
      sort === 'visits'
        ? '(COALESCE(cb.historical_purchases, 0) + COALESCE(lo.live_purchases, 0)) DESC'
        : sort === 'last_purchase'
          ? 'COALESCE(lo.last_order, cb.last_purchase_at) DESC NULLS LAST'
          : '(COALESCE(cb.historical_spend_halire, 0) + COALESCE(lo.live_spend, 0)) DESC';

    const args: unknown[] = [promoter.promoterId];
    const qFilter = q
      ? `AND (cb.email ILIKE $2 OR cb.name ILIKE $2)`
      : '';
    if (q) args.push(`%${q}%`);

    const dataArgs = [...args, limit, offset];

    const r = await db().query<CustomerRow>(
      `WITH contact_base AS (
        SELECT
          COALESCE(pc.email, u.email) AS email,
          COALESCE(pc.name, u.name) AS name,
          pc.phone,
          COALESCE(pc.historical_purchases, 0) AS historical_purchases,
          COALESCE(pc.historical_spend_halire, 0) AS historical_spend_halire,
          pc.import_source,
          pc.opted_out,
          pc.last_purchase_at,
          u.id AS user_id
        FROM platform.promoter_contacts pc
        LEFT JOIN identity.users u ON u.email = pc.email
        WHERE pc.promoter_id = $1
      ),
      live_orders AS (
        SELECT u.email,
          COUNT(DISTINCT o.id)::bigint AS live_purchases,
          COALESCE(SUM(o.total_amount), 0) AS live_spend,
          MAX(o.created_at) AS last_order
        FROM orders.orders o
        JOIN identity.users u ON u.id = o.user_id
        JOIN orders.order_items oi ON oi.order_id = o.id
        JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
        JOIN catalog.events e ON e.id = tt.event_id
        WHERE e.promoter_id = $1 AND o.status = 'paid'
        GROUP BY u.email
      )
      SELECT
        cb.email,
        cb.name,
        cb.phone,
        cb.historical_purchases,
        cb.historical_spend_halire,
        cb.import_source,
        cb.opted_out,
        cb.user_id,
        COALESCE(lo.live_purchases, 0)::text AS live_purchases,
        COALESCE(lo.live_spend, 0)::text AS live_spend_halire,
        (cb.historical_purchases + COALESCE(lo.live_purchases, 0))::text AS total_visits,
        (cb.historical_spend_halire + COALESCE(lo.live_spend, 0))::text AS total_ltv_halire,
        COALESCE(lo.last_order, cb.last_purchase_at) AS last_seen_at
      FROM contact_base cb
      LEFT JOIN live_orders lo ON lo.email = cb.email
      WHERE TRUE ${qFilter}
      ORDER BY ${orderBy}
      LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      dataArgs,
    );

    const statsArgs: unknown[] = [promoter.promoterId];
    const statsRes = await db().query<StatsRow>(
      `WITH contact_base AS (
        SELECT pc.email,
          pc.import_source,
          u.id AS user_id
        FROM platform.promoter_contacts pc
        LEFT JOIN identity.users u ON u.email = pc.email
        WHERE pc.promoter_id = $1
      ),
      live_buyers AS (
        SELECT DISTINCT u.email
        FROM orders.orders o
        JOIN identity.users u ON u.id = o.user_id
        JOIN orders.order_items oi ON oi.order_id = o.id
        JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
        JOIN catalog.events e ON e.id = tt.event_id
        WHERE e.promoter_id = $1 AND o.status = 'paid'
      )
      SELECT
        COUNT(*)::text AS total_contacts,
        COUNT(*) FILTER (WHERE cb.import_source IS NOT NULL)::text AS total_from_import,
        COUNT(lb.email)::text AS total_live_buyers,
        COALESCE(AVG(
          (SELECT COALESCE(SUM(o2.total_amount), 0)
           FROM orders.orders o2
           JOIN orders.order_items oi2 ON oi2.order_id = o2.id
           JOIN catalog.ticket_types tt2 ON tt2.id = oi2.ticket_type_id
           JOIN catalog.events e2 ON e2.id = tt2.event_id
           WHERE e2.promoter_id = $1 AND o2.status = 'paid' AND o2.user_id = cb.user_id)
        ), 0)::text AS avg_ltv
      FROM contact_base cb
      LEFT JOIN live_buyers lb ON lb.email = cb.email`,
      statsArgs,
    );

    const stats = statsRes.rows[0];

    return NextResponse.json({
      customers: r.rows.map((c) => ({
        email: c.email,
        name: c.name,
        phone: c.phone,
        historicalPurchases: Number(c.historical_purchases ?? 0),
        historicalSpendHalire: Number(c.historical_spend_halire ?? 0),
        importSource: c.import_source,
        optedOut: c.opted_out,
        userId: c.user_id,
        livePurchases: Number(c.live_purchases),
        liveSpendHalire: Number(c.live_spend_halire),
        totalVisits: Number(c.total_visits),
        totalLtvHalire: Number(c.total_ltv_halire),
        lastSeenAt: c.last_seen_at,
      })),
      stats: {
        totalContacts: Number(stats?.total_contacts ?? 0),
        totalFromImport: Number(stats?.total_from_import ?? 0),
        totalLiveBuyers: Number(stats?.total_live_buyers ?? 0),
        avgLtv: Number(stats?.avg_ltv ?? 0),
      },
      page,
      limit,
    });
  });
}
