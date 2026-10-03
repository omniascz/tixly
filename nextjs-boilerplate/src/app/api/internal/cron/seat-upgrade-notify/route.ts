/**
 * POST /api/internal/cron/seat-upgrade-notify
 * Runs hourly — finds paid orders with upgrade-eligible better seats available
 * and sends an email notification to the buyer.
 * Unique differentiator: neither Eventim nor Ticketmaster does this automatically.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isInternalTokenAuthorized } from '@/lib/security/cron-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { sendMail } from '@/lib/email/mailer';

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

export async function POST(req: NextRequest): Promise<Response> {
  // Kolo 3 (K3a kontrola cron rout): dřív se při chybějícím env token neporovnával → bez
  // INTERNAL_SERVICE_TOKEN v env prošel jakýkoli token. Fail-closed sdíleným helperem.
  if (!isInternalTokenAuthorized(req)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Cron bezi bez uzivatele — bez kontextu by RLS odfiltrovalo vse.
  // POZOR: pod servisnim kontextem si musi routa filtrovat sama.
  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

      // Kolo 4: dřív četl `catalog.seats` (sedadla SÁLU — bez event_id, zone_name, row_label,
      // label, is_available, is_held) a deduplikoval přes neexistující
      // seat_upgrades.order_id/notified_at → cron vždy spadl. Sedadla akce jsou
      // `catalog.event_seats` (order_items.seat_id → event_seats.id); log upozornění je
      // `orders.seat_upgrade_notifications` (migrace 490).
      //
      // „Lepší" místo = volné sedadlo téže akce, téhož typu vstupenky (stejná cena) a sektoru
      // v nižší řadě, nebo v téže řadě s nižším číslem. Řady i čísla se porovnávají přirozeně
      // (lpad), aby „10" nebylo před „9".
      const candidatesRes = await client.query<{
        order_id: string;
        buyer_email: string | null;
        event_title: string;
        date_start: string;
        sector: string;
        current_row: string;
        current_seat: string;
        better_seats: number;
      }>(
        `SELECT DISTINCT ON (o.id)
                o.id AS order_id,
                bu.email AS buyer_email,
                e.title AS event_title,
                e.date_start::text AS date_start,
                es.sector, es.row AS current_row, es.seat_number AS current_seat,
                better.n AS better_seats
           FROM orders.orders o
           JOIN orders.order_items oi ON oi.order_id = o.id AND oi.seat_id IS NOT NULL
           JOIN catalog.event_seats es ON es.id = oi.seat_id
           JOIN catalog.events e ON e.id = o.event_id
           LEFT JOIN identity.users bu ON bu.id = o.user_id
           CROSS JOIN LATERAL (
             SELECT COUNT(*)::int AS n
               FROM catalog.event_seats es2
              WHERE es2.event_id = es.event_id
                AND es2.ticket_type_id IS NOT DISTINCT FROM es.ticket_type_id
                AND es2.sector = es.sector
                AND es2.status = 'available'
                AND (lpad(es2.row, 8, '0') < lpad(es.row, 8, '0')
                     OR (es2.row = es.row AND lpad(es2.seat_number, 8, '0') < lpad(es.seat_number, 8, '0')))
           ) better
          WHERE o.status = 'paid'
            AND e.date_start > NOW() + INTERVAL '2 days'
            AND e.date_start < NOW() + INTERVAL '90 days'
            AND better.n > 0
            AND bu.email IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM orders.seat_upgrade_notifications n
               WHERE n.order_id = o.id AND n.notified_at > NOW() - INTERVAL '7 days'
            )
          ORDER BY o.id, lpad(es.row, 8, '0'), lpad(es.seat_number, 8, '0')
          LIMIT 200`,
      );

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://app.tixly.cz';
      let notified = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const cand of candidatesRes.rows) {
        try {
          await sendMail({
            to: cand.buyer_email!,
            subject: `Uvolnilo se lepší místo — ${cand.event_title}`,
            html: `<p>Na akci <strong>${escapeHtml(cand.event_title)}</strong> se v sektoru
              <strong>${escapeHtml(cand.sector)}</strong> uvolnilo ${cand.better_seats === 1 ? 'lepší místo' : `${cand.better_seats} lepších míst`}
              než vaše (řada ${escapeHtml(cand.current_row)}, místo ${escapeHtml(cand.current_seat)}).</p>
              <p><a href="${appUrl}/cs/my-tickets">Zobrazit moje vstupenky a možnosti výměny</a></p>`,
          });
          // Zápis až po úspěšném odeslání — jinak by se neodeslané upozornění tvářilo jako hotové.
          await client.query(
            `INSERT INTO orders.seat_upgrade_notifications (order_id, notified_at, better_seats)
             VALUES ($1, NOW(), $2)
             ON CONFLICT (order_id) DO UPDATE SET notified_at = NOW(), better_seats = EXCLUDED.better_seats`,
            [cand.order_id, cand.better_seats],
          );
          notified++;
        } catch (err) {
          // Jedna položka nesmí shodit celý běh — ale nesmí se ani ztratit.
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
        notified,
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
