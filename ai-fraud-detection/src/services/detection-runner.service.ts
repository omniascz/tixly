// =============================================================================
// Detection runner — orchestrates all detectors/patterns and pushes flagged
// cases into the fraud-queue module.
// =============================================================================

import {
  detectVelocitySpike,
  detectPriceOutlier,
  detectTimeOutlier,
  detectAmountOutlier,
  detectDuplicateCard,
  detectRapidAccountCreation,
  detectCircularRefund,
  detectGeographicJump,
  detectSharedDeviceCluster,
} from '../lib/anomaly-detectors.js';
import { detectPatterns } from '../lib/pattern-recognition.js';
import { findUserClusters } from '../lib/graph-analytics.js';
import { AiFraudError } from '../lib/fraud-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';
import {
  AnomalyDetectorConfig,
  AnomalySignal,
  DEFAULT_DETECTOR_CONFIG,
  FraudReport,
  Recommendation,
  SEVERITY_WEIGHT,
  SubjectType,
} from '../types/detection.js';

// ---------------------------------------------------------------------------
// Optional injected fraud-queue ingest (tests replace this)
// ---------------------------------------------------------------------------

export interface FraudQueueIngestPayload {
  promoterId: string | null;
  sourceModule: string;
  sourceRefId: string;
  severity: 'high' | 'critical';
  score: number;
  signals: string[];
  description: string;
}

export type FraudQueueIngestFn = (
  payload: FraudQueueIngestPayload,
  deps: ServiceDeps,
) => Promise<void>;

let ingestOverride: FraudQueueIngestFn | null = null;

/** Test hook — allows tests to mock the fraud-queue ingest without HTTP. */
export function setFraudQueueIngest(fn: FraudQueueIngestFn | null): void {
  ingestOverride = fn;
}

async function defaultFraudQueueIngest(
  payload: FraudQueueIngestPayload,
  _deps: ServiceDeps,
): Promise<void> {
  // Dynamic import — avoids a hard compile-time dep across workspace modules.
  try {
    const mod = (await import('@tixly/fraud-queue/services/fraud-queue.service.js').catch(
      () => null,
    )) as { enqueueFraudCase?: (...args: unknown[]) => Promise<unknown> } | null;
    if (mod?.enqueueFraudCase) {
      // Fraud-queue expects a richer input; we synthesize a minimal one.
      await mod.enqueueFraudCase(
        {
          orderId: payload.sourceRefId,
          userId: 'unknown',
          promoterId: payload.promoterId ?? undefined,
          amountHellers: 0,
          riskScore: payload.score,
          signals: payload.signals.map((s) => ({ rule: 'ai_detector', detail: s, score: 0 })),
          sourceModule: payload.sourceModule,
          sourceRefId: payload.sourceRefId,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        _deps as any,
      );
      return;
    }
  } catch {
    /* fall through to HTTP */
  }

  // HTTP fallback
  const url = process.env.FRAUD_QUEUE_INGEST_URL ?? 'http://fraud-queue/api/fraud/ingest';
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-auth': process.env.INTERNAL_AUTH_TOKEN ?? '',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* swallow — detection run itself should not fail if queue is unreachable */
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function computeTotalScore(signals: AnomalySignal[]): number {
  let score = 0;
  for (const s of signals) {
    score += SEVERITY_WEIGHT[s.severity] * (s.confidence / 100);
  }
  return Math.min(100, Math.round(score));
}

export function deriveRecommendation(
  totalScore: number,
  config: AnomalyDetectorConfig,
): Recommendation {
  if (totalScore >= config.blockThreshold) return 'block';
  if (totalScore >= config.reviewThreshold) return 'review';
  return 'allow';
}

function validateConfig(config: AnomalyDetectorConfig): void {
  if (
    config.reviewThreshold < 0 ||
    config.reviewThreshold > 100 ||
    config.blockThreshold < 0 ||
    config.blockThreshold > 100 ||
    config.reviewThreshold > config.blockThreshold
  ) {
    throw new AiFraudError('INVALID_THRESHOLD');
  }
}

// ---------------------------------------------------------------------------
// Subject-specific detector dispatch
// ---------------------------------------------------------------------------

async function runOrderDetectors(
  orderId: string,
  deps: ServiceDeps,
): Promise<{ signals: AnomalySignal[]; userId: string | null; promoterId: string | null }> {
  // Fetch a few context fields (best-effort — if schema doesn't expose, defaults).
  const [row] = await deps.db.query<{
    user_id: string | null;
    promoter_id: string | null;
  }>(
    `SELECT user_id, promoter_id FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (!row) throw new AiFraudError('SUBJECT_NOT_FOUND');

  const checks = await Promise.all([
    detectPriceOutlier(orderId, deps),
    detectTimeOutlier(orderId, deps),
    detectAmountOutlier(orderId, deps),
    row.user_id ? detectVelocitySpike('user', row.user_id, deps) : Promise.resolve(null),
  ]);

  const patternMatches = await detectPatterns('order', orderId, deps);
  const patternSignals: AnomalySignal[] = patternMatches.map((m) => ({
    type: 'velocity_spike', // patterns don't map 1:1 to AnomalyType — use a generic marker
    severity: m.confidence >= 85 ? 'high' : 'medium',
    confidence: m.confidence,
    description: `pattern:${m.pattern} — ${m.evidence.join('; ')}`,
    linkedEntityIds: m.linkedEntityIds,
    detectedAt: new Date(),
  }));

  const signals = [...checks.filter((x): x is AnomalySignal => x !== null), ...patternSignals];
  return { signals, userId: row.user_id, promoterId: row.promoter_id };
}

async function runUserDetectors(
  userId: string,
  deps: ServiceDeps,
): Promise<{ signals: AnomalySignal[]; promoterId: string | null }> {
  const checks = await Promise.all([
    detectVelocitySpike('user', userId, deps),
    detectCircularRefund(userId, deps),
    detectGeographicJump(userId, deps),
  ]);

  const patternMatches = await detectPatterns('user', userId, deps);
  const patternSignals: AnomalySignal[] = patternMatches.map((m) => ({
    type: 'velocity_spike',
    severity: m.confidence >= 85 ? 'high' : 'medium',
    confidence: m.confidence,
    description: `pattern:${m.pattern} — ${m.evidence.join('; ')}`,
    linkedEntityIds: m.linkedEntityIds,
    detectedAt: new Date(),
  }));

  const signals = [...checks.filter((x): x is AnomalySignal => x !== null), ...patternSignals];
  return { signals, promoterId: null };
}

async function runDeviceDetectors(
  fingerprintHash: string,
  deps: ServiceDeps,
): Promise<AnomalySignal[]> {
  const s = await detectSharedDeviceCluster(fingerprintHash, deps);
  return s ? [s] : [];
}

// ---------------------------------------------------------------------------
// runDetection
// ---------------------------------------------------------------------------

export async function runDetection(
  subjectType: SubjectType,
  subjectId: string,
  config: AnomalyDetectorConfig,
  deps: ServiceDeps,
): Promise<FraudReport> {
  validateConfig(config);

  let signals: AnomalySignal[] = [];
  let promoterId: string | null = null;

  if (subjectType === 'order') {
    const r = await runOrderDetectors(subjectId, deps);
    signals = r.signals;
    promoterId = r.promoterId;
  } else if (subjectType === 'user') {
    const r = await runUserDetectors(subjectId, deps);
    signals = r.signals;
    promoterId = r.promoterId;
  } else if (subjectType === 'device') {
    signals = await runDeviceDetectors(subjectId, deps);
  }

  const totalScore = computeTotalScore(signals);
  const recommendation = deriveRecommendation(totalScore, config);

  // Persist the run
  try {
    await deps.db.execute(
      `INSERT INTO risk.detection_runs (subject_type, subject_id, total_score, recommendation, signals)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [subjectType, subjectId, totalScore, recommendation, JSON.stringify(signals)],
    );
  } catch {
    /* non-fatal */
  }

  // Push to fraud-queue if above threshold
  if (recommendation !== 'allow') {
    const ingest = ingestOverride ?? defaultFraudQueueIngest;
    try {
      await ingest(
        {
          promoterId,
          sourceModule: 'ai-fraud-detection',
          sourceRefId: `${subjectType}:${subjectId}`,
          severity: recommendation === 'block' ? 'critical' : 'high',
          score: totalScore,
          signals: signals.map((s) => s.description),
          description: `AI detector: ${signals.length} anomalies, total score ${totalScore}`,
        },
        deps,
      );
    } catch {
      /* detection itself still succeeds */
    }

    if (recommendation === 'block') {
      deps.kafka
        .send('fraud.detected.block', {
          subjectType,
          subjectId,
          totalScore,
          signals: signals.map((s) => s.type),
        })
        .catch(() => {});
    }
  }

  return { subjectType, subjectId, signals, totalScore, recommendation };
}

// ---------------------------------------------------------------------------
// sweepRecentOrders — cron entry point
// ---------------------------------------------------------------------------

export async function sweepRecentOrders(
  hoursLookback: number,
  config: AnomalyDetectorConfig = DEFAULT_DETECTOR_CONFIG,
  deps: ServiceDeps,
): Promise<{ scanned: number; flagged: number; blocked: number }> {
  validateConfig(config);

  const rows = await deps.db.query<{ id: string }>(
    `SELECT id::text AS id FROM orders.orders
     WHERE created_at > NOW() - ($1::int * INTERVAL '1 hour')
     ORDER BY created_at DESC
     LIMIT 5000`,
    [hoursLookback],
  );

  let flagged = 0;
  let blocked = 0;
  for (const r of rows) {
    try {
      const report = await runDetection('order', r.id, config, deps);
      if (report.recommendation === 'review') flagged++;
      if (report.recommendation === 'block') {
        flagged++;
        blocked++;
      }
    } catch {
      /* keep going */
    }
  }

  return { scanned: rows.length, flagged, blocked };
}

/**
 * Cluster sweep — runs graph analytics per promoter to uncover rings.
 * Not called by routes by default; exposed for completeness.
 */
export async function sweepPromoterClusters(
  promoterId: string,
  deps: ServiceDeps,
): Promise<number> {
  const clusters = await findUserClusters(promoterId, deps);
  return clusters.length;
}
