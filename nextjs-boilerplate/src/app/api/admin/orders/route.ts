/**
 * GET /api/admin/orders?eventId=&status=&search=&from=&to=&page=1&limit=20
 *
 * Vrací seznam objednávek pro daného promotéra s filtry a paginací.
 * Headers: Authorization: Bearer <token> (x-user-id musí být člen promotéra)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

interface OrderRow {
  order_id: string;
  created_at: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  event_id: string;
  event_name: string;
  total_halire: number;
  ticket_count: number;
  ticket_summary: string;
  status: string;
  paid_at: string | null;
}

interface TotalRow {
  // PostgreSQL COUNT(*) vrací BIGINT, který pg klient serializuje jako string.
  // SUM() na INTEGER vrací BIGINT taky.
  total_count: string | number;
  total_revenue: string | number;
}

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

/**
 * Helper: check if user is promoter member and return promoter_id
 */
async function getPromoterIdForUser(db: Pool, userId: string): Promise<string | null> {
  const result = await db.query(
    'SELECT promoter_id FROM platform.promoter_members WHERE user_id = $1 AND status = $2 LIMIT 1',
    [userId, 'active']
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0].promoter_id;
}

/**
 * Helper: validate and convert search pattern
 */
function buildSearchPattern(search: string | null): string | null {
  if (!search || search.trim() === '') {
    return null;
  }
  return `%${search.trim()}%`;
}


export async function GET(request: NextRequest): Promise<Response> {
  const db = getDb();

  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 401 });
    }

    // Check promoter membership
    const promoterId = await getPromoterIdForUser(db, userId);
    if (!promoterId) {
      return NextResponse.json({ error: 'Not a promoter member' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId') || null;
    const status = searchParams.get('status') || null;
    const search = searchParams.get('search') || null;
    const from = searchParams.get('from') || null;
    const to = searchParams.get('to') || null;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '20', 10));
    const offset = (page - 1) * limit;

    const searchPattern = buildSearchPattern(search);

    // Build base WHERE clause
    const whereClauses = ['e.promoter_id = $1'];
    const params: unknown[] = [promoterId];
    let paramIndex = 2;

    if (eventId) {
      whereClauses.push(`o.event_id = $${paramIndex}`);
      params.push(eventId);
      paramIndex++;
    }

    if (status) {
      whereClauses.push(`o.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (searchPattern) {
      whereClauses.push(
        `(u.name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
      );
      params.push(searchPattern);
      paramIndex++;
    }

    if (from) {
      whereClauses.push(`o.created_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      whereClauses.push(`o.created_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = whereClauses.join(' AND ');

    // Count query
    const countQuery = `
      SELECT COUNT(*) as total_count, COALESCE(SUM(o.total_amount), 0) as total_revenue
      FROM orders.orders o
      JOIN identity.users u ON u.id = o.user_id
      JOIN catalog.events e ON e.id = o.event_id
      WHERE ${whereClause}
    `;

    const countResult = await db.query<TotalRow>(countQuery, params);
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    const totalRevenue = Number(countResult.rows[0]?.total_revenue ?? 0);

    // Main query with ticket summary
    const mainQuery = `
      SELECT
        o.id as order_id,
        o.created_at,
        o.status,
        o.paid_at,
        o.total_amount as total_halire,
        u.name as buyer_name,
        u.email as buyer_email,
        u.phone as buyer_phone,
        e.id as event_id,
        e.title as event_name,
        (SELECT string_agg(oi.quantity || '× ' || tt.name, ', ')
         FROM orders.order_items oi
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         WHERE oi.order_id = o.id) AS ticket_summary,
        (SELECT SUM(oi.quantity) FROM orders.order_items oi WHERE oi.order_id = o.id) AS ticket_count
      FROM orders.orders o
      JOIN identity.users u ON u.id = o.user_id
      JOIN catalog.events e ON e.id = o.event_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const result = await db.query<OrderRow>(mainQuery, params);

    // Format response with order numbers
    const items = result.rows.map((row, index) => {
      const orderNum = `ORD-2026-${String(index + offset + 1).padStart(4, '0')}`;
      return {
        orderId: row.order_id,
        orderNumber: orderNum,
        createdAt: row.created_at,
        buyerName: row.buyer_name,
        buyerEmail: row.buyer_email,
        buyerPhone: row.buyer_phone,
        eventId: row.event_id,
        eventName: row.event_name,
        totalHalire: row.total_halire,
        ticketCount: row.ticket_count || 0,
        ticketSummary: row.ticket_summary || '',
        status: row.status,
        paidAt: row.paid_at,
      };
    });

    await db.end();

    return NextResponse.json({
      items,
      total: totalCount,
      totalRevenueHalire: totalRevenue,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[GET /api/admin/orders]', error);
    await db.end();
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
