/**
 * churn-scoring.service.ts — Orchestrates the full churn scoring pipeline:
 *
 *   1. Extract raw features from the database
 *   2. Normalise features
 *   3. Run logistic regression to get churn probability
 *   4. Determine the retention action for the given horizon
 *   5. Upsert result to ai.churn_predictions
 *   6. Return a complete ChurnPrediction record
 */

import { extractPassFeatures } from "../lib/feature-extractor";
import {
  getTopFeatures,
  normalizeFeatures,
  predictChurnProbability,
} from "../lib/logistic-regression";
import {
  ChurnPrediction,
  ChurnScoringError,
  DbAdapter,
  PassNotFoundError,
  PredictionHorizon,
  RetentionAction,
  ServiceDeps,
} from "../types/churn.types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODEL_VERSION = "logistic-v1";

/**
 * Thresholds that map (horizon, probability) → RetentionAction.
 *
 * Scoring schedule (from spec):
 *   30d → email_reminder  if probability > 0.6
 *   14d → email_discount  if probability > 0.7
 *    7d → push_highlight  if probability > 0.8
 */
const ACTION_THRESHOLDS: Record<
  PredictionHorizon,
  { threshold: number; action: RetentionAction }
> = {
  "30d": { threshold: 0.6, action: RetentionAction.EmailReminder },
  "14d": { threshold: 0.7, action: RetentionAction.EmailDiscount },
  "7d": { threshold: 0.8, action: RetentionAction.PushHighlight },
};

// ─── DB row shapes (internal) ─────────────────────────────────────────────────

interface ChurnPredictionRow {
  id: string;
  pass_id: string;
  user_id: string;
  churn_probability: number;
  top_features: unknown;
  model_version: string;
  prediction_horizon: PredictionHorizon;
  retention_action: RetentionAction;
  computed_at: string;
  action_executed_at: string | null;
  action_result: "renewed" | "churned" | null;
}

interface PassUserRow {
  user_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function determineRetentionAction(
  probability: number,
  horizon: PredictionHorizon,
): RetentionAction {
  const config = ACTION_THRESHOLDS[horizon];
  return probability > config.threshold ? config.action : RetentionAction.None;
}

function rowToChurnPrediction(row: ChurnPredictionRow): ChurnPrediction {
  return {
    id: row.id,
    passId: row.pass_id,
    userId: row.user_id,
    churnProbability: row.churn_probability,
    topFeatures: row.top_features as ChurnPrediction["topFeatures"],
    modelVersion: row.model_version,
    predictionHorizon: row.prediction_horizon,
    retentionAction: row.retention_action,
    computedAt: row.computed_at,
    actionExecutedAt: row.action_executed_at,
    actionResult: row.action_result,
  };
}

async function getUserIdForPass(
  passId: string,
  db: DbAdapter,
): Promise<string> {
  const row = await db.queryOne<PassUserRow>(
    `SELECT user_id FROM passes.season_passes WHERE id = $1`,
    [passId],
  );

  if (row === null) {
    throw new PassNotFoundError(passId);
  }

  return row.user_id;
}

// ─── Core scoring ─────────────────────────────────────────────────────────────

/**
 * Scores a single pass and persists the result to ai.churn_predictions.
 *
 * Uses UPSERT on (pass_id, prediction_horizon) so repeated calls for the
 * same pass and horizon update the existing row rather than creating
 * duplicates. This is safe to call idempotently from the cron job.
 */
export async function scorePass(
  passId: string,
  horizon: PredictionHorizon,
  deps: ServiceDeps,
): Promise<ChurnPrediction> {
  const { db } = deps;

  const userId = await getUserIdForPass(passId, db);

  const raw = await extractPassFeatures(passId, db);
  const normalised = normalizeFeatures(raw);
  const probability = predictChurnProbability(normalised);
  const topFeatures = getTopFeatures(normalised);
  const retentionAction = determineRetentionAction(probability, horizon);
  const computedAt = new Date().toISOString();

  // UPSERT into ai.churn_predictions
  const rows = await db.query<ChurnPredictionRow>(
    `INSERT INTO ai.churn_predictions
       (pass_id, user_id, churn_probability, top_features, model_version,
        prediction_horizon, retention_action, computed_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     ON CONFLICT (pass_id, prediction_horizon)
     DO UPDATE SET
       churn_probability  = EXCLUDED.churn_probability,
       top_features       = EXCLUDED.top_features,
       model_version      = EXCLUDED.model_version,
       retention_action   = EXCLUDED.retention_action,
       computed_at        = EXCLUDED.computed_at
     RETURNING
       id, pass_id, user_id, churn_probability, top_features, model_version,
       prediction_horizon, retention_action, computed_at,
       action_executed_at, action_result`,
    [
      passId,
      userId,
      probability,
      JSON.stringify(topFeatures),
      MODEL_VERSION,
      horizon,
      retentionAction,
      computedAt,
    ],
  );

  const row = rows[0];
  if (row === undefined) {
    throw new ChurnScoringError(
      `Upsert returned no row for passId=${passId}`,
      "UPSERT_FAILED",
      passId,
    );
  }

  return rowToChurnPrediction(row);
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Returns all churn predictions that:
 *   - meet or exceed the minimum probability threshold
 *   - have a non-null retention action
 *   - have not yet had their action executed (action_result IS NULL)
 *
 * Sorted by churn_probability descending so the highest-risk passes are
 * processed first by the Marketing Service.
 */
export async function getActionableChurnPredictions(
  minProbability: number,
  horizon: PredictionHorizon,
  db: DbAdapter,
): Promise<ChurnPrediction[]> {
  const rows = await db.query<ChurnPredictionRow>(
    `SELECT
       id, pass_id, user_id, churn_probability, top_features, model_version,
       prediction_horizon, retention_action, computed_at,
       action_executed_at, action_result
     FROM ai.churn_predictions
     WHERE churn_probability >= $1
       AND prediction_horizon = $2
       AND retention_action IS NOT NULL
       AND retention_action != $3
       AND action_result IS NULL
     ORDER BY churn_probability DESC`,
    [minProbability, horizon, RetentionAction.None],
  );

  return rows.map(rowToChurnPrediction);
}

/**
 * Marks a single prediction as having had its retention action dispatched.
 * Sets action_executed_at to NOW().
 */
export async function markActionExecuted(
  predictionId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE ai.churn_predictions
     SET action_executed_at = NOW()
     WHERE id = $1`,
    [predictionId],
  );
}

/**
 * Records the final outcome (renewed or churned) for all predictions
 * associated with a pass, regardless of horizon.
 *
 * Called by the renewal webhook or expiry processor once the outcome is known.
 */
export async function recordOutcome(
  passId: string,
  outcome: "renewed" | "churned",
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE ai.churn_predictions
     SET action_result = $1
     WHERE pass_id = $2`,
    [outcome, passId],
  );
}
