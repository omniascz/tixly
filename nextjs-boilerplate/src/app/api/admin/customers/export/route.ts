import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const r = await db().query<{
      email: string;
      name: string | null;
      phone: string | null;
      total_visits: string;
      total_ltv_halire: string;
      last_seen_at: string | null;
      import_source: string | null;
    }>(
      `WITH contact_base AS (
        SELECT
          COALESCE(pc.email, u.email) AS email,
          COALESCE(pc.name, u.name) AS name,
          pc.phone,
          COALESCE(pc.historical_purchases, 0) AS historical_purchases,
          COALESCE(pc.historical_spend_halire, 0) AS historical_spend_halire,
          pc.import_source,
          pc.last_purchase_at
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
        cb.import_source,
        (cb.historical_purchases + COALESCE(lo.live_purchases, 0))::text AS total_visits,
        (cb.historical_spend_halire + COALESCE(lo.live_spend, 0))::text AS total_ltv_halire,
        COALESCE(lo.last_order, cb.last_purchase_at) AS last_seen_at
      FROM contact_base cb
      LEFT JOIN live_orders lo ON lo.email = cb.email
      ORDER BY (cb.historical_spend_halire + COALESCE(lo.live_spend, 0)) DESC`,
      [promoter.promoterId],
    );

    const header = 'Email,Jméno,Telefon,Celkem návštěv,LTV (Kč),Poslední nákup,Zdroj\n';
    const rows = r.rows.map((c) => {
      const ltv = (Number(c.total_ltv_halire) / 100).toFixed(2).replace('.', ',');
      const lastSeen = c.last_seen_at
        ? new Date(c.last_seen_at).toLocaleDateString('cs-CZ')
        : '';
      const source = c.import_source ? c.import_source : 'Tixly';
      return [
        csvEscape(c.email),
        csvEscape(c.name),
        csvEscape(c.phone),
        csvEscape(c.total_visits),
        csvEscape(ltv),
        csvEscape(lastSeen),
        csvEscape(source),
      ].join(',');
    });

    const csv = header + rows.join('\n');
    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="zakaznici-${date}.csv"`,
      },
    });
  });
}
