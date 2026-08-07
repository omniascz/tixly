/**
 * POST /api/internal/cron/verify-event-completion
 *
 * P0 RISK MITIGATION (z docs/risk-analysis):
 * Den po akci kontroluje scanner statistiky a marknout akci jako:
 *   - completed   → scan_rate ≥ 30% (akce reálně proběhla)
 *   - suspicious  → scan_rate 10-30% (částečně, master admin review)
 *   - no_show    → scan_rate < 10% (PODEZŘELÉ — hold payout, kontaktovat promotéra)
 *
 * Spouští se denně 8:00 (post-event check pro včerejší akce).
 *
 * Pro suspicious + no_show:
 *   - Hold payout (nastavit payout_hold_until = +30 dní)
 *   - Notify master admin
 *   - Notify buyer: "Akce X byla podezřele odbavena, můžete žádat refund"
 *
 * Auth: x-internal-token.
 */
import { timingSafeEqual } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';


function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface EventStats {
  event_id: string;
  title: string;
  promoter_id: string;
  date_end: string;
  total_tickets: number;
  scanned_tickets: number;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Events co skončily včera nebo dříve + ještě nemají completion verified
  // (date_end < TODAY) AND (completion_status = 'pending')
  let stats: EventStats[];
  try {
    const r = await db().query<EventStats>(
      `SELECT
         e.id AS event_id,
         e.title,
         e.promoter_id,
         COALESCE(e.date_end, e.date_start)::text AS date_end,
         COUNT(t.id)::int AS total_tickets,
         COUNT(t.id) FILTER (WHERE t.used_at IS NOT NULL)::int AS scanned_tickets
         FROM catalog.events e
         LEFT JOIN orders.orders o ON o.event_id = e.id AND o.status = 'paid'
         LEFT JOIN tickets.tickets t ON t.order_id = o.id
        WHERE e.completion_status = 'pending'
          AND e.status = 'published'
          AND COALESCE(e.date_end, e.date_start) < NOW()
          AND COALESCE(e.date_end, e.date_start) > NOW() - INTERVAL '30 days'
        GROUP BY e.id
        LIMIT 200`,
    );
    stats = r.rows;
  } catch (err) {
    // Selhani UVODNIHO dotazu neni "preskoceno" — nic se nezpracovalo a nikdo
    // se to nedozvedel. ok:false, at je to videt v monitoringu.
    console.error('[verify-event-completion] uvodni dotaz selhal:', err);
    return NextResponse.json({
      ok: false, processed: 0, failed: 1,
      errors: [`stats query: ${(err as Error).message.slice(0, 160)}`],
    });
  }

  let failed = 0;
  const errors: string[] = [];
  let completed = 0;
  let suspicious = 0;
  let noShow = 0;
  let zeroTickets = 0;

  for (const ev of stats) {
    if (ev.total_tickets === 0) {
      // Žádné prodané lístky — akce mohla být zadarmo. Marknout completed default.
      await db().query(
        `UPDATE catalog.events
            SET completion_status = 'completed',
                completion_verified_at = NOW(),
                scan_rate_pct = 100
          WHERE id = $1`,
        [ev.event_id],
      );
      zeroTickets += 1;
      continue;
    }

    const scanRate = Math.round((ev.scanned_tickets / ev.total_tickets) * 100);
    let newStatus: 'completed' | 'suspicious' | 'no_show';
    let holdExtension: string | null = null;

    if (scanRate >= 30) {
      newStatus = 'completed';
      completed += 1;
    } else if (scanRate >= 10) {
      newStatus = 'suspicious';
      // Extend payout hold by 30 dní pro master review
      holdExtension = "NOW() + INTERVAL '30 days'";
      suspicious += 1;
    } else {
      // < 10% scan rate = high probability no-show / scam
      newStatus = 'no_show';
      // Extend payout hold by 90 dní (= aspoň chargeback window 120 dní z velkě části pokryt)
      holdExtension = "NOW() + INTERVAL '90 days'";
      noShow += 1;
    }

    await db().query(
      `UPDATE catalog.events
          SET completion_status = $1,
              completion_verified_at = NOW(),
              scan_rate_pct = $2,
              payout_hold_until = ${holdExtension ? holdExtension : 'payout_hold_until'}
        WHERE id = $3`,
      [newStatus, scanRate, ev.event_id],
    );

    // Pro suspicious/no_show: insert audit alert
    if (newStatus === 'suspicious' || newStatus === 'no_show') {
      try {
        await db().query(
          // D12: schema je pravda. Kod psal `payload` (sloupec NEEXISTUJE, 42703),
          // vynechaval `message` (NOT NULL, 23502) a alert_type mimo CHECK (23514).
          // Vsechny tri opraveny podle skutecneho schematu, migrace neni potreba.
          //
          // alert_type = 'low_velocity': z povoleneho vyctu
          //   traffic_spike | refund_spike | fraud_cluster | queue_overflow
          //   | sellout_imminent | low_velocity
          // je to jedina hodnota, ktera popisuje ANOMALNE NIZKOU MIRU — a presne
          // to se tu meri (podil naskenovanych listku). 'fraud_cluster' by tvrdil
          // PODVOD, coz tahle kontrola neprokazuje: nula skenu muze byt zrusena
          // akce nebo vypadek turniketu. Falesny podvodny signal v anomaly feedu
          // je horsi nez presna, ale obecnejsi kategorie.
          //
          // event_id ma VLASTNI SLOUPEC — driv se schovaval jen v JSON.
          `INSERT INTO audit.anomaly_alerts
             (promoter_id, event_id, alert_type, severity, message, metadata)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            ev.promoter_id,
            ev.event_id,
            'low_velocity',
            newStatus === 'no_show' ? 'critical' : 'warning',
            newStatus === 'no_show'
              ? `Akce "${ev.title}" skoncila bez jedineho naskenovaneho listku (${ev.total_tickets} prodanych).`
              : `Akce "${ev.title}" ma podezrele nizky podil skenu: ${scanRate} % z ${ev.total_tickets} listku.`,
            JSON.stringify({
              event_id: ev.event_id,
              event_title: ev.title,
              scan_rate_pct: scanRate,
              total_tickets: ev.total_tickets,
              scanned_tickets: ev.scanned_tickets,
              recommendation:
                newStatus === 'no_show'
                  ? 'CONTACT PROMOTER. Hold payout. Notify buyers about refund option.'
                  : 'Master admin review. Possible partial event.',
            }),
          ],
        );
      } catch (err) {
        // Drive "silent". Zapis do audit.anomaly_alerts je soucast ukolu —
        // kdyz spadne, cron uz nesmi tvrdit, ze probehl cely.
        failed++;
        errors.push(`anomaly_alert ${ev.event_id}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    processed: completed,
    failed,
    errors: errors.slice(0, 20),
    checked: stats.length,
    completed,
    suspicious,
    noShow,
    zeroTickets,
  });

  });
}
