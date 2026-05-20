/**
 * GET /api/admin/orders/export?eventId=&status=&search=&from=&to=
 *
 * Exportuje všechny objednávky (bez paginace) jako CSV.
 * Headers: Authorization: Bearer <token>
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { formatCzk, formatCzechDateShort } from '@/lib/format.js';

export const dynamic = 'force-dynamic';


interface OrderRow {
  order_id: string;
  created_at: string;
  buyer_name: string;
  buyer_email: string;
  buyer_phone: string | null;
  event_name: string;
  total_halire: number;
  ticket_summary: string;
  status: string;
}

function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL not set');
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

async function getPromoterIdForUser(db: Pool, userId: string): Promise<string | null> {
  const result = await db.query<{ promoter_id: string }>(
    'SELECT promoter_id FROM platform.promoter_members WHERE user_id = $1 AND status = $2 LIMIT 1',
    [userId, 'active']
  );
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0].promoter_id;
}

function buildSearchPattern(search: string | null): string | null {
  if (!search || search.trim() === '') {
    return null;
  }
  return `%${search.trim()}%`;
}

function formatStatusCzech(status: string): string {
  const statusMap: Record<string, string> = {
    paid: 'Zaplaceno',
    pending: 'Čeká',
    cancelled: 'Zrušeno',
    refunded: 'Vráceno',
    awaiting_payment: 'Čeká na platbu',
    expired: 'Vypršelo',
  };
  return statusMap[status] || status;
}

function escapeCsv(value: string | null | undefined): string {
  if (!value) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: NextRequest): Promise<Response> {
  const db = getDb();

  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json({ error: 'Missing x-user-id header' }, { status: 401 });
    }

    const promoterId = await getPromoterIdForUser(db, userId);
    if (!promoterId) {
      return NextResponse.json({ error: 'Not a promoter member' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('eventId') || null;
    const status = searchParams.get('status') || null;
    const search = searchParams.get('search') || null;
    const from = searchParams.get('from') || null;
    const to = searchParams.get('to') || null;

    const searchPattern = buildSearchPattern(search);

    // Build WHERE clause — orders.orders nemá promoter_id, scoping přes events JOIN
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

    const query = `
      SELECT
        o.id as order_id,
        o.created_at,
        u.name as buyer_name,
        u.email as buyer_email,
        u.phone as buyer_phone,
        e.title as event_name,
        o.total_amount as total_halire,
        (SELECT string_agg(oi.quantity || '× ' || tt.name, ', ')
         FROM orders.order_items oi
         JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
         WHERE oi.order_id = o.id) AS ticket_summary,
        o.status
      FROM orders.orders o
      JOIN identity.users u ON u.id = o.user_id
      JOIN catalog.events e ON e.id = o.event_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
    `;

    const result = await db.query<OrderRow>(query, params);

    // Build CSV
    const headers = ['Číslo', 'Datum', 'Jméno', 'Email', 'Telefon', 'Akce', 'Vstupenky', 'Částka', 'Stav'];
    const rows = result.rows.map((row, index) => [
      escapeCsv(`ORD-2026-${String(index + 1).padStart(4, '0')}`),
      escapeCsv(formatCzechDateShort(row.created_at)),
      escapeCsv(row.buyer_name),
      escapeCsv(row.buyer_email),
      escapeCsv(row.buyer_phone),
      escapeCsv(row.event_name),
      escapeCsv(row.ticket_summary),
      escapeCsv(formatCzk(row.total_halire)),
      escapeCsv(formatStatusCzech(row.status)),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;

    await db.end();

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="objednavky-${dateStr}.csv"`,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[GET /api/admin/orders/export]', error);
    await db.end();
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
