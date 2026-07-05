/**
 * GET /api/admin/anti-scalping/overview
 *
 * Agregovaná data pro Anti-scalping & Abuse Prevention dashboard.
 * Vrátí: fraud statistiky, top signály, aktivní ochrany per event.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    const pid = promoter.promoterId;

    const [fraudStats, signalAgg, protectedEvents, recentAlerts] = await Promise.all([
      // Fraud scoring stats za posledních 30 dní
      db().query<{
        total: string;
        blocked: string;
        review: string;
        allowed: string;
        avg_score: string | null;
      }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE fraud_decision = 'block')::text AS blocked,
           COUNT(*) FILTER (WHERE fraud_decision = 'review')::text AS review,
           COUNT(*) FILTER (WHERE fraud_decision = 'allow')::text AS allowed,
           ROUND(AVG(fraud_score), 1)::text AS avg_score
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
         WHERE e.promoter_id = $1
           AND o.created_at > NOW() - INTERVAL '30 days'`,
        [pid],
      ),

      // Top fraud signály (z JSONB fraud_signals, agregace top klíčů)
      db().query<{ signal: string; count: string }>(
        `SELECT
           jsonb_array_elements_text(o.fraud_signals->'topReasons') AS signal,
           COUNT(*)::text AS count
         FROM orders.orders o
         JOIN catalog.events e ON e.id = o.event_id
         WHERE e.promoter_id = $1
           AND o.fraud_decision IN ('block', 'review')
           AND o.fraud_signals ? 'topReasons'
           AND o.created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1
         ORDER BY 2::int DESC
         LIMIT 8`,
        [pid],
      ),

      // Události s aktivními ochranami
      db().query<{
        id: string;
        title: string;
        date_start: string;
        queue_enabled: boolean;
        verified_fan_enabled: boolean;
        requires_otp_validation: boolean;
        require_phone_verified: boolean;
      }>(
        `SELECT id, title, date_start::text,
                COALESCE(queue_enabled, FALSE) AS queue_enabled,
                COALESCE(verified_fan_enabled, FALSE) AS verified_fan_enabled,
                COALESCE(requires_otp_validation, FALSE) AS requires_otp_validation,
                COALESCE(require_phone_verified, FALSE) AS require_phone_verified
         FROM catalog.events
         WHERE promoter_id = $1
           AND status = 'published'
           AND date_start > NOW() - INTERVAL '7 days'
         ORDER BY date_start
         LIMIT 10`,
        [pid],
      ),

      // Poslední fraud/security alerty
      db().query<{
        id: string;
        alert_type: string;
        severity: string;
        message: string;
        created_at: string;
        event_title: string | null;
      }>(
        `SELECT a.id, a.alert_type, a.severity, a.message, a.created_at::text,
                e.title AS event_title
         FROM audit.anomaly_alerts a
         LEFT JOIN catalog.events e ON e.id = a.event_id
         WHERE a.promoter_id = $1
           AND a.alert_type IN ('fraud_cluster', 'traffic_spike', 'queue_overflow', 'bot_detected')
           AND a.created_at > NOW() - INTERVAL '7 days'
         ORDER BY a.created_at DESC
         LIMIT 5`,
        [pid],
      ).catch(() => ({ rows: [] as { id: string; alert_type: string; severity: string; message: string; created_at: string; event_title: string | null }[] })),
    ]);

    const stats = fraudStats.rows[0];
    const total = parseInt(stats?.total ?? '0', 10);
    const blocked = parseInt(stats?.blocked ?? '0', 10);
    const review = parseInt(stats?.review ?? '0', 10);

    return NextResponse.json({
      period: { days: 30 },
      fraud: {
        total,
        blocked,
        review,
        allowed: parseInt(stats?.allowed ?? '0', 10),
        blockRate: total > 0 ? Math.round((blocked / total) * 100 * 10) / 10 : 0,
        avgScore: stats?.avg_score ? parseFloat(stats.avg_score) : null,
      },
      topSignals: signalAgg.rows.map((r) => ({
        signal: r.signal,
        count: parseInt(r.count, 10),
      })),
      protectedEvents: protectedEvents.rows,
      recentAlerts: recentAlerts.rows,
    });
  });
}
