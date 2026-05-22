/**
 * GET /api/admin/reports/nipos?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv
 *
 * NIPOS Kult 1-01 export pro promotéra. Agreguje:
 *   - catalog.events × catalog.event_category (theatre/music/sport/...)
 *   - tickets.tickets (status, used_at, original_price)
 *   - orders.orders (total_amount, refund flag)
 *
 * Promotér scope: jen vlastní events. Platform admin: všech promotérů
 * (volitelně ?promoterId=).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';
import {
  summaryToCsv,
  type NiposReportRow,
  type NiposReportSummary,
} from '@/lib/reporting/nipos';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function parseDate(s: string | null, fallback: Date): Date {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return fallback;
  return d;
}

const CATEGORY_LABELS: Record<string, string> = {
  music: 'Hudba',
  theatre: 'Divadlo',
  sport: 'Sport',
  club: 'Klubová akce',
  family: 'Pro rodiny',
  comedy: 'Komedie',
  conference: 'Konference',
  other: 'Ostatní',
};

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const periodStart = parseDate(req.nextUrl.searchParams.get('from'), quarterStart);
  const periodEnd = parseDate(req.nextUrl.searchParams.get('to'), now);
  const format = (req.nextUrl.searchParams.get('format') ?? 'json').toLowerCase();

  if (periodEnd < periodStart) {
    return NextResponse.json({ error: 'INVALID_RANGE' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    // Promoter name
    const pr = await client.query<{ name: string }>(
      `SELECT name FROM platform.promoters WHERE id = $1`,
      [promoter.promoterId],
    );
    const promoterName = pr.rows[0]?.name ?? 'Unknown';

    const rows = await client.query<{
      category: string;
      events_planned: string;
      events_held: string;
      visitors_total: string;
      visitors_paying: string;
      gross_revenue_halire: string;
      refunded_tickets: string;
      refunded_revenue_halire: string;
    }>(
      `
      WITH period_events AS (
        SELECT e.id, e.category, e.date_start
          FROM catalog.events e
         WHERE e.promoter_id = $1
           AND e.date_start >= $2
           AND e.date_start < $3
      ),
      ticket_stats AS (
        SELECT pe.category,
               COUNT(t.id) FILTER (WHERE t.status = 'valid') AS visitors_total,
               COUNT(t.id) FILTER (WHERE t.status = 'valid' AND t.original_price > 0) AS visitors_paying,
               COALESCE(SUM(t.original_price) FILTER (WHERE t.status = 'valid'), 0) AS gross_revenue,
               COUNT(t.id) FILTER (WHERE t.status = 'revoked') AS refunded_tickets,
               COALESCE(SUM(t.original_price) FILTER (WHERE t.status = 'revoked'), 0) AS refunded_revenue
          FROM period_events pe
          JOIN orders.orders o ON o.event_id = pe.id
          JOIN tickets.tickets t ON t.order_id = o.id
        GROUP BY pe.category
      ),
      event_counts AS (
        SELECT category,
               COUNT(*) AS planned,
               COUNT(*) FILTER (WHERE date_start < NOW()) AS held
          FROM period_events
        GROUP BY category
      )
      SELECT
        COALESCE(ec.category, ts.category) AS category,
        COALESCE(ec.planned, 0)::text AS events_planned,
        COALESCE(ec.held, 0)::text AS events_held,
        COALESCE(ts.visitors_total, 0)::text AS visitors_total,
        COALESCE(ts.visitors_paying, 0)::text AS visitors_paying,
        COALESCE(ts.gross_revenue, 0)::text AS gross_revenue_halire,
        COALESCE(ts.refunded_tickets, 0)::text AS refunded_tickets,
        COALESCE(ts.refunded_revenue, 0)::text AS refunded_revenue_halire
      FROM event_counts ec
      FULL OUTER JOIN ticket_stats ts ON ts.category = ec.category
      ORDER BY 1
      `,
      [promoter.promoterId, periodStart.toISOString(), periodEnd.toISOString()],
    );

    await client.query('COMMIT');

    const byCategory: NiposReportRow[] = rows.rows.map((r) => ({
      category: CATEGORY_LABELS[r.category] ?? r.category,
      eventsPlanned: Number(r.events_planned),
      eventsHeld: Number(r.events_held),
      visitorsTotal: Number(r.visitors_total),
      visitorsPaying: Number(r.visitors_paying),
      grossRevenueHalire: Number(r.gross_revenue_halire),
      refundedTickets: Number(r.refunded_tickets),
      refundedRevenueHalire: Number(r.refunded_revenue_halire),
    }));

    const summary: NiposReportSummary = {
      promoterId: promoter.promoterId,
      promoterName,
      periodStart: periodStart.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      totalEvents: byCategory.reduce((s, r) => s + r.eventsPlanned, 0),
      totalVisitors: byCategory.reduce((s, r) => s + r.visitorsTotal, 0),
      totalRevenueHalire: byCategory.reduce((s, r) => s + r.grossRevenueHalire, 0),
      byCategory,
    };

    if (format === 'csv') {
      const csv = summaryToCsv(summary);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="nipos-${summary.periodStart}-${summary.periodEnd}.csv"`,
        },
      });
    }

    return NextResponse.json(summary);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET /api/admin/reports/nipos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
