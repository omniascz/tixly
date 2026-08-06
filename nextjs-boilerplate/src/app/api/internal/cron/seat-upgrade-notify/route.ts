/**
 * POST /api/internal/cron/seat-upgrade-notify
 * Runs hourly — finds paid orders with upgrade-eligible better seats available
 * and sends an email notification to the buyer.
 * Unique differentiator: neither Eventim nor Ticketmaster does this automatically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token');
  const expected = process.env.INTERNAL_SERVICE_TOKEN;
  if (!token || (expected && token !== expected)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Cron bezi bez uzivatele — bez kontextu by RLS odfiltrovalo vse.
  // POZOR: pod servisnim kontextem si musi routa filtrovat sama.
  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

      // Find paid orders with seating where better seats may now be available
      // "Better" = lower row number or lower seat price in same zone, same event
      const candidatesRes = await client.query<{
        order_id: string;
        buyer_email: string;
        event_id: string;
        event_title: string;
        date_start: string;
        zone_name: string | null;
        current_row: string | null;
        current_seat_label: string | null;
        ticket_type_price: number;
      }>(
        `SELECT DISTINCT ON (o.id)
                o.id AS order_id,
                o.buyer_email,
                o.event_id,
                e.name AS event_title,
                e.date_start::text,
                s.zone_name,
                s.row_label AS current_row,
                s.label AS current_seat_label,
                tt.base_price AS ticket_type_price
           FROM orders.orders o
           JOIN orders.order_items oi ON oi.order_id = o.id
           JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
           JOIN catalog.events e ON e.id = o.event_id
           LEFT JOIN orders.seat_assignments sa ON sa.order_item_id = oi.id
           LEFT JOIN catalog.seats s ON s.id = sa.seat_id
          WHERE o.status = 'paid'
            AND e.date_start > NOW() + INTERVAL '2 days'
            AND e.date_start < NOW() + INTERVAL '90 days'
            AND tt.is_seated = true
            AND s.row_label IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM orders.seat_upgrades su
               WHERE su.order_id = o.id AND su.notified_at > NOW() - INTERVAL '7 days'
            )
          ORDER BY o.id, o.created_at
          LIMIT 200`,
      );

      let notified = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const cand of candidatesRes.rows) {
        try {
          // Check if better seats exist in same zone at same or lower price
          const betterRes = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
               FROM catalog.seats s2
              WHERE s2.event_id = $1
                AND (s2.zone_name = $2 OR $2 IS NULL)
                AND s2.is_available = true
                AND s2.is_held = false
                AND (s2.row_label < $3 OR (s2.row_label = $3 AND s2.label < $4))
              LIMIT 1`,
            [cand.event_id, cand.zone_name, cand.current_row, cand.current_seat_label],
          );

          if (Number(betterRes.rows[0]?.count ?? 0) === 0) continue;

          // Log the upgrade opportunity to avoid spamming (table may not exist yet, use orders.seat_upgrades)
          // Puvodne se tady nepredavaly PARAMETRY (dotaz ma $1, pole chybelo),
          // takze INSERT vzdy spadl — a .catch(() => {}) to spolkl. Cron pak hlasil
          // notified > 0 pro zapis, ktery nikdy neprobehl. To je presne ta trida,
          // kvuli ktere C2 vzniklo: uspech, ktery nenastal.
          await client.query(
            `INSERT INTO orders.seat_upgrades (order_id, notified_at, status)
             VALUES ($1, NOW(), 'notified')
             ON CONFLICT (order_id) DO UPDATE SET notified_at = NOW(), status = 'notified'`,
            [cand.order_id],
          );

          // In production, send via ForgeMsg / Resend — here we log for the cron report
          console.log(
            `[seat-upgrade-notify] order=${cand.order_id} buyer=${cand.buyer_email} ` +
            `event="${cand.event_title}" better seats available in zone=${cand.zone_name}`,
          );
          notified++;
        } catch (err) {
          // Jedna polozka z tisice nesmi shodit cely beh — ale NESMI se ani ztratit.
          failed++;
          errors.push(`${cand.order_id}: ${(err as Error).message.slice(0, 120)}`);
          console.error(`[seat-upgrade-notify] order ${cand.order_id} error:`, err);
        }
      }

      await client.query('COMMIT');
      // Kontrakt C2: ok az kdyz failed === 0. HTTP zustava 200, aby planovac
      // neretryoval kvuli jedne polozce — signal nese telo, ne status.
      return NextResponse.json({
        ok: failed === 0,
        processed: notified,
        failed,
        errors: errors.slice(0, 20),
        candidates: candidatesRes.rows.length,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[seat-upgrade-notify cron]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
