// funnel.service.ts — Tracking kroků checkout funnelu a reporting.
//
// Klíčové vlastnosti:
//  - trackStep je fire-and-forget: chyby se logují, ale NIKDY nerozbijí checkout
//  - Anonymní tracking: userId nullable, sessionId neobsahuje PII (GDPR)
//  - Kafka topic: 'tixly.funnel.step-tracked'

import { calculateFunnelStats, calculateOverallConversionRate } from '../lib/funnel-calculator';
import {
  FUNNEL_STEPS,
  FunnelEvent,
  FunnelReport,
  FunnelStep,
} from '../types/funnel.types';
import { withTenantContext } from '@tixly/rls-multitenancy';
import type { DbAdapter } from '@tixly/rls-multitenancy';

// ─── Adapters ────────────────────────────────────────────────────────────────

export interface KafkaAdapter {
  send(topic: string, payload: unknown): Promise<void>;
}

export interface ServiceDeps {
  db: DbAdapter;
  kafka: KafkaAdapter;
}

// ─── Kafka topic ─────────────────────────────────────────────────────────────

const KAFKA_TOPIC = 'tixly.funnel.step-tracked';

// ─── trackStep ───────────────────────────────────────────────────────────────

export interface TrackStepParams {
  sessionId: string;
  /** Nullable — anonymní uživatelé před přihlášením (žádná PII) */
  userId?: string | null;
  eventId: string;
  step: FunnelStep;
  metadata?: Record<string, unknown>;
}

/**
 * Zaznamená krok funnelu.
 *
 * Fire-and-forget: funkce vrátí ihned, chyby nerozbijí checkout.
 * Interně zapíše do DB a odešle Kafka event.
 */
export function trackStep(deps: ServiceDeps, params: TrackStepParams): void {
  const { db, kafka } = deps;
  const { sessionId, userId = null, eventId, step, metadata = {} } = params;
  const id = crypto.randomUUID();
  const createdAt = new Date();

  // Fire-and-forget — záměrně nevracíme Promise volajícímu
  void (async () => {
    try {
      await withTenantContext(db, { role: 'service' }, async (txDb) => {
        await txDb.execute(
          `INSERT INTO analytics.funnel_events
             (id, session_id, user_id, event_id, step, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, sessionId, userId, eventId, step, JSON.stringify(metadata), createdAt],
        );
      });

      await kafka.send(KAFKA_TOPIC, {
        id,
        sessionId,
        userId,
        eventId,
        step,
        metadata,
        createdAt: createdAt.toISOString(),
      });
    } catch (err) {
      // Chyba nesmí rozbít checkout — pouze logujeme
      console.error('[funnel] trackStep failed (fire-and-forget):', err);
    }
  })();
}

// ─── getFunnelReport ──────────────────────────────────────────────────────────

/**
 * Vrátí FunnelReport pro danou akci a časové období.
 * Přístup omezen na promotéra akce (withTenantContext).
 */
export async function getFunnelReport(
  deps: ServiceDeps,
  promoterId: string,
  eventId: string,
  from: Date,
  to: Date,
): Promise<FunnelReport> {
  return withTenantContext(
    deps.db,
    { role: 'promoter', promoterId },
    async (db) => {
      const rows = await db.query<{ step: FunnelStep; count: string }>(
        `SELECT step, COUNT(*) AS count
           FROM analytics.funnel_events
          WHERE event_id = $1
            AND created_at >= $2
            AND created_at <= $3
          GROUP BY step`,
        [eventId, from, to],
      );

      // Sestavíme Record<FunnelStep, number> se všemi kroky (výchozí 0)
      const stepCounts = Object.fromEntries(
        FUNNEL_STEPS.map((s) => [s, 0]),
      ) as Record<FunnelStep, number>;

      for (const row of rows) {
        if (row.step in stepCounts) {
          stepCounts[row.step] = parseInt(row.count, 10);
        }
      }

      const steps = calculateFunnelStats(stepCounts);
      const overallConversionRate = calculateOverallConversionRate(steps);

      return {
        eventId,
        period: { from, to },
        steps,
        overallConversionRate,
      };
    },
  );
}

// ─── getSessionPath ───────────────────────────────────────────────────────────

/**
 * Vrátí seřazené kroky konkrétní session (pro debugging drop-offů).
 * sessionId je anonymní identifikátor bez PII.
 */
export async function getSessionPath(
  deps: ServiceDeps,
  sessionId: string,
): Promise<FunnelEvent[]> {
  return withTenantContext(deps.db, { role: 'service' }, async (db) => {
    const rows = await db.query<{
      id: string;
      session_id: string;
      user_id: string | null;
      event_id: string;
      step: FunnelStep;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id, session_id, user_id, event_id, step, metadata, created_at
         FROM analytics.funnel_events
        WHERE session_id = $1
        ORDER BY created_at ASC`,
      [sessionId],
    );

    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      userId: r.user_id,
      eventId: r.event_id,
      step: r.step,
      metadata: r.metadata ?? {},
      createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    }));
  });
}
