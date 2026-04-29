/**
 * churn-scoring.job.ts — Daily cron job (06:00) that scores all active season
 * passes approaching expiry and emits Kafka events for actionable predictions.
 *
 * Three passes per run (ordered from earliest to latest horizon):
 *   30d — expires in 29–31 days
 *   14d — expires in 13–15 days
 *    7d — expires in  6–8 days
 *
 * Processing guarantees:
 *   - Promise.allSettled ensures one failed pass does not halt the batch
 *   - SIGINT / SIGTERM trigger graceful shutdown after the current horizon pass
 *   - Summary log at the end: "Scored X passes, Y actionable, Z errors"
 */

import { scorePass } from "../services/churn-scoring.service";
import {
  ChurnScoredPayload,
  DbAdapter,
  KafkaProducerAdapter,
  PredictionHorizon,
  RetentionAction,
  ServiceDeps,
} from "../types/churn.types";

// ─── Configuration ────────────────────────────────────────────────────────────

const KAFKA_TOPIC = "churn.scored";

/** Horizon definitions with the SQL INTERVAL range for expiry matching. */
const HORIZONS: Array<{
  horizon: PredictionHorizon;
  daysLow: number;
  daysHigh: number;
}> = [
  { horizon: "30d", daysLow: 29, daysHigh: 31 },
  { horizon: "14d", daysLow: 13, daysHigh: 15 },
  { horizon: "7d", daysLow: 6, daysHigh: 8 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobDeps {
  db: DbAdapter;
  kafka: KafkaProducerAdapter;
}

interface JobSummary {
  scored: number;
  actionable: number;
  errors: number;
  durationMs: number;
}

interface ActivePassRow {
  id: string;
  user_id: string;
}

// ─── DB query ─────────────────────────────────────────────────────────────────

async function fetchPassesForHorizon(
  db: DbAdapter,
  daysLow: number,
  daysHigh: number,
): Promise<ActivePassRow[]> {
  return db.query<ActivePassRow>(
    `SELECT id, user_id
     FROM passes.season_passes
     WHERE status = 'active'
       AND expires_at BETWEEN NOW() + ($1 * INTERVAL '1 day')
                          AND NOW() + ($2 * INTERVAL '1 day')`,
    [daysLow, daysHigh],
  );
}

// ─── Main job ─────────────────────────────────────────────────────────────────

export async function runChurnScoringJob(deps: JobDeps): Promise<JobSummary> {
  const startedAt = Date.now();
  let scored = 0;
  let actionable = 0;
  let errors = 0;
  let shutdownRequested = false;

  const serviceDeps: ServiceDeps = { db: deps.db, kafka: deps.kafka };

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const onShutdown = () => {
    console.log(
      "[churn-scoring-job] Shutdown requested — will stop after current horizon pass",
    );
    shutdownRequested = true;
  };
  process.on("SIGINT", onShutdown);
  process.on("SIGTERM", onShutdown);

  // ── Process each horizon ─────────────────────────────────────────────────
  for (const { horizon, daysLow, daysHigh } of HORIZONS) {
    if (shutdownRequested) break;

    let passes: ActivePassRow[];
    try {
      passes = await fetchPassesForHorizon(deps.db, daysLow, daysHigh);
    } catch (err) {
      console.error(
        `[churn-scoring-job] Failed to fetch passes for horizon=${horizon}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    console.log(
      `[churn-scoring-job] horizon=${horizon} — ${passes.length} passes to score`,
    );

    const results = await Promise.allSettled(
      passes.map(async (pass) => {
        const prediction = await scorePass(pass.id, horizon, serviceDeps);

        scored++;

        if (prediction.retentionAction !== RetentionAction.None) {
          actionable++;

          const payload: ChurnScoredPayload = {
            passId: prediction.passId,
            userId: prediction.userId,
            churnProbability: prediction.churnProbability,
            predictionHorizon: prediction.predictionHorizon,
            retentionAction: prediction.retentionAction,
            topFeatures: prediction.topFeatures,
            computedAt: prediction.computedAt,
          };

          await deps.kafka.produce(KAFKA_TOPIC, pass.id, payload);
        }
      }),
    );

    // Count rejections
    for (const result of results) {
      if (result.status === "rejected") {
        errors++;
        console.error(
          `[churn-scoring-job] Pass scoring failed (horizon=${horizon}):`,
          result.reason instanceof Error
            ? result.reason.message
            : result.reason,
        );
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  process.off("SIGINT", onShutdown);
  process.off("SIGTERM", onShutdown);

  const durationMs = Date.now() - startedAt;
  console.log(
    `[churn-scoring-job] Completed in ${durationMs}ms — ` +
      `Scored ${scored} passes, ${actionable} actionable, ${errors} errors`,
  );

  return { scored, actionable, errors, durationMs };
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────
//
// This file can be invoked directly with tsx for manual runs or wired into a
// node-cron / systemd timer. The actual schedule (daily 06:00) is managed by
// the infrastructure layer, not this module.
//
// Example: tsx src/jobs/churn-scoring.job.ts

if (process.argv[1]?.endsWith("churn-scoring.job.ts")) {
  // Lazy-import to avoid bundling these heavy deps when imported as a module
  Promise.resolve().then(async () => {
    const { createDbAdapter } = await import("../lib/db-adapter.js" as string);
    const { createKafkaProducer } = await import(
      "../lib/kafka-producer.js" as string
    );

    const db = createDbAdapter();
    const kafka = createKafkaProducer();

    const summary = await runChurnScoringJob({ db, kafka });
    process.exit(summary.errors > 0 ? 1 : 0);
  }).catch((err: unknown) => {
    console.error("[churn-scoring-job] Fatal error:", err);
    process.exit(1);
  });
}
