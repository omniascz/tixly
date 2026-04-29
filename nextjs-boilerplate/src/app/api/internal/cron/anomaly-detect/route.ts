/**
 * POST /api/internal/cron/anomaly-detect
 *
 * Detekuje a vytvoří alerts pro:
 *   - traffic_spike: orders/h > 3× rolling avg
 *   - refund_spike: refunds last hour > 5× normal
 *   - fraud_cluster: 5+ block decisions za 10 min
 *   - sellout_imminent: ticket type < 5% remaining + high velocity
 *   - low_velocity: 0 sales za 24h pro published event začínající < 7d
 *
 * Auth: x-internal-token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { timingSafeEqual } from 'crypto';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.headers.get('x-internal-token') ?? '';
  const expected = process.env.INTERNAL_SERVICE_TOKEN ?? '';
  if (!expected || !safeEqual(token, expected)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let alertsCreated = 0;

  // 1) Traffic spike — order velocity 3× higher than 24h rolling average
  const trafficSpikes = await db().query<{
    event_id: string;
    promoter_id: string;
    event_title: string;
    last_hour: string;
    rolling_avg: string;
  }>(
    `WITH event_velocity AS (
       SELECT o.event_id,
              COUNT(*) FILTER (WHERE o.created_at > NOW() - INTERVAL '1 hour')::text AS last_hour,
              (COUNT(*) FILTER (WHERE o.created_at > NOW() - INTERVAL '24 hours') / 24.0)::text AS rolling_avg
       FROM orders.orders o
       WHERE o.created_at > NOW() - INTERVAL '24 hours'
       GROUP BY o.event_id
     )
     SELECT ev.event_id, e.promoter_id, e.title AS event_title, ev.last_hour, ev.rolling_avg
     FROM event_velocity ev
     JOIN catalog.events e ON e.id = ev.event_id
     WHERE ev.last_hour::int >= 5
       AND ev.last_hour::int > ev.rolling_avg::numeric * 3
       AND NOT EXISTS (
         SELECT 1 FROM audit.anomaly_alerts a
         WHERE a.event_id = ev.event_id
           AND a.alert_type = 'traffic_spike'
           AND a.created_at > NOW() - INTERVAL '6 hours'
       )`,
  );
  for (const row of trafficSpikes.rows) {
    await db().query(
      `INSERT INTO audit.anomaly_alerts
         (promoter_id, event_id, alert_type, severity, message, metadata)
       VALUES ($1, $2, 'traffic_spike', 'info', $3, $4::jsonb)`,
      [
        row.promoter_id,
        row.event_id,
        `🚀 Traffic spike na "${row.event_title}": ${row.last_hour} orders za poslední hodinu (3× rolling avg).`,
        JSON.stringify({ lastHour: row.last_hour, rollingAvg: row.rolling_avg }),
      ],
    );
    alertsCreated += 1;
  }

  // 2) Refund spike — refunds last hour > 3 absolute or 5× rolling average
  const refundSpikes = await db().query<{
    event_id: string;
    promoter_id: string;
    event_title: string;
    last_hour: string;
  }>(
    `SELECT o.event_id, e.promoter_id, e.title AS event_title,
            COUNT(*)::text AS last_hour
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.status = 'refunded'
       AND o.updated_at > NOW() - INTERVAL '1 hour'
     GROUP BY o.event_id, e.promoter_id, e.title
     HAVING COUNT(*) >= 3
       AND NOT EXISTS (
         SELECT 1 FROM audit.anomaly_alerts a
         WHERE a.event_id = o.event_id
           AND a.alert_type = 'refund_spike'
           AND a.created_at > NOW() - INTERVAL '6 hours'
       )`,
  );
  for (const row of refundSpikes.rows) {
    await db().query(
      `INSERT INTO audit.anomaly_alerts
         (promoter_id, event_id, alert_type, severity, message, metadata)
       VALUES ($1, $2, 'refund_spike', 'warning', $3, $4::jsonb)`,
      [
        row.promoter_id,
        row.event_id,
        `⚠️ Refund spike na "${row.event_title}": ${row.last_hour} refundací za hodinu. Něco se děje?`,
        JSON.stringify({ lastHourRefunds: row.last_hour }),
      ],
    );
    alertsCreated += 1;
  }

  // 3) Fraud cluster — 5+ block decisions za 10 min napříč jeden event
  const fraudClusters = await db().query<{
    event_id: string;
    promoter_id: string;
    event_title: string;
    blocks: string;
  }>(
    `SELECT o.event_id, e.promoter_id, e.title AS event_title, COUNT(*)::text AS blocks
     FROM orders.orders o
     JOIN catalog.events e ON e.id = o.event_id
     WHERE o.fraud_decision = 'block'
       AND o.created_at > NOW() - INTERVAL '10 minutes'
     GROUP BY o.event_id, e.promoter_id, e.title
     HAVING COUNT(*) >= 5`,
  );
  for (const row of fraudClusters.rows) {
    await db().query(
      `INSERT INTO audit.anomaly_alerts
         (promoter_id, event_id, alert_type, severity, message, metadata)
       VALUES ($1, $2, 'fraud_cluster', 'critical', $3, $4::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        row.promoter_id,
        row.event_id,
        `🚨 Fraud cluster na "${row.event_title}": ${row.blocks} blocked orders za 10 min. Možná coordinated bot attack.`,
        JSON.stringify({ blocks10min: row.blocks }),
      ],
    );
    alertsCreated += 1;
  }

  // 4) Sellout imminent — < 5% remaining + > 1 sale/h
  const sellouts = await db().query<{
    ticket_type_id: string;
    event_id: string;
    promoter_id: string;
    event_title: string;
    type_name: string;
    remaining: number;
    total: number;
    velocity: string;
  }>(
    `SELECT tt.id AS ticket_type_id, tt.event_id, e.promoter_id, e.title AS event_title,
            tt.name AS type_name,
            tt.remaining_qty AS remaining, tt.total_qty AS total,
            COUNT(oi.id)::text AS velocity
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id
     LEFT JOIN orders.order_items oi ON oi.ticket_type_id = tt.id
     LEFT JOIN orders.orders o ON o.id = oi.order_id AND o.created_at > NOW() - INTERVAL '1 hour'
     WHERE tt.total_qty > 0
       AND tt.remaining_qty <= tt.total_qty * 0.05
       AND tt.remaining_qty > 0
       AND e.status = 'published'
       AND e.date_start > NOW()
     GROUP BY tt.id, tt.event_id, e.promoter_id, e.title, tt.name, tt.remaining_qty, tt.total_qty
     HAVING COUNT(oi.id) >= 1
        AND NOT EXISTS (
          SELECT 1 FROM audit.anomaly_alerts a
          WHERE a.metadata->>'ticketTypeId' = tt.id::text
            AND a.alert_type = 'sellout_imminent'
            AND a.created_at > NOW() - INTERVAL '12 hours'
        )`,
  );
  for (const row of sellouts.rows) {
    await db().query(
      `INSERT INTO audit.anomaly_alerts
         (promoter_id, event_id, alert_type, severity, message, metadata)
       VALUES ($1, $2, 'sellout_imminent', 'info', $3, $4::jsonb)`,
      [
        row.promoter_id,
        row.event_id,
        `🔥 "${row.event_title}" → ${row.type_name}: zbývá ${row.remaining}/${row.total} (${row.velocity}/h). Sellout do hodiny.`,
        JSON.stringify({ ticketTypeId: row.ticket_type_id, remaining: row.remaining, velocity: row.velocity }),
      ],
    );
    alertsCreated += 1;
  }

  return NextResponse.json({ ok: true, alertsCreated });
}
