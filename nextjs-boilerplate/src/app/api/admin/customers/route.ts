/**
 * GET /api/admin/customers?q=&segment=&limit=&offset=
 *
 * Server-side agregace kupců promotéra (z orders + identity.users).
 * Nahrazuje původní klient-side reduce z 5 stránek orders, který nestačí
 * pro promotéry s víc než 500 zákazníky.
 *
 * Segment: champion (≥5 ord + ≥2000 Kč) | loyal (≥2 ord) | new | at_risk (>180d)
 *           | lost (>365d) — počítá se per řádek.
 * q: hledat v email/name (LIKE).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';


interface CustomerRow {
  user_id: string;
  email: string;
  name: string | null;
  phone: string | null;
  orders_count: string;
  total_spent_halire: string;
  first_order_at: string;
  last_order_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const url = req.nextUrl;
  const q = url.searchParams.get('q');
  const segment = url.searchParams.get('segment');
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const wheres: string[] = [
    `e.promoter_id = $1`,
    `o.status = 'paid'`,
    `u.email NOT LIKE 'walkin+%'`, // exclude POS walk-ins
    `u.deleted_at IS NULL`,
  ];
  const args: unknown[] = [promoter.promoterId];
  let p = 2;
  if (q) {
    args.push(`%${q}%`);
    wheres.push(`(u.email ILIKE $${p} OR u.name ILIKE $${p})`);
    p++;
  }

  // Segment filter — vychází z agregace, ne raw rows, takže HAVING
  let having = '';
  if (segment === 'champion') {
    having = `HAVING COUNT(*) >= 5 AND SUM(o.total_amount) >= 200000`;
  } else if (segment === 'loyal') {
    having = `HAVING COUNT(*) >= 2`;
  } else if (segment === 'at_risk') {
    having = `HAVING MAX(COALESCE(o.paid_at, o.created_at)) < now() - interval '180 days'
             AND MAX(COALESCE(o.paid_at, o.created_at)) > now() - interval '365 days'`;
  } else if (segment === 'lost') {
    having = `HAVING MAX(COALESCE(o.paid_at, o.created_at)) < now() - interval '365 days'`;
  } else if (segment === 'new') {
    having = `HAVING COUNT(*) = 1`;
  }

  args.push(limit, offset);
  const limitOffsetIdx = `LIMIT $${p++} OFFSET $${p++}`;

  const r = await db().query<CustomerRow>(
    `SELECT
       u.id AS user_id,
       u.email,
       u.name,
       u.phone,
       COUNT(*)::text AS orders_count,
       SUM(o.total_amount)::text AS total_spent_halire,
       MIN(COALESCE(o.paid_at, o.created_at)) AS first_order_at,
       MAX(COALESCE(o.paid_at, o.created_at)) AS last_order_at
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     WHERE ${wheres.join(' AND ')}
     GROUP BY u.id, u.email, u.name, u.phone
     ${having}
     ORDER BY total_spent_halire DESC NULLS LAST, last_order_at DESC
     ${limitOffsetIdx}`,
    args,
  );

  // Total count for pagination (bez limit/offset)
  const countRes = await db().query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM (
       SELECT u.id
       FROM orders.orders o
       JOIN identity.users u ON u.id = o.user_id
       JOIN catalog.events e ON e.id = o.event_id
       WHERE ${wheres.slice(0, q ? 5 : 4).join(' AND ')}
       GROUP BY u.id ${having || ''}
     ) sub`,
    args.slice(0, q ? 2 : 1),
  );

  return NextResponse.json({
    customers: r.rows.map((c) => ({
      userId: c.user_id,
      email: c.email,
      name: c.name,
      phone: c.phone,
      ordersCount: Number(c.orders_count),
      totalSpentHalire: Number(c.total_spent_halire),
      firstOrderAt: c.first_order_at,
      lastOrderAt: c.last_order_at,
    })),
    total: Number(countRes.rows[0]?.cnt ?? 0),
    limit,
    offset,
  });

  });
}
