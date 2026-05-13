// =============================================================================
// Auto Early Bird Cutoff — Feature #124
//
// ML-based prediction of optimal Early Bird pricing cutoff date.
// Uses injectable MlAdapter so the service is testable without a live model.
//
// The ML model considers:
//   - Historical sell velocity for similar events
//   - Current sales pace (tickets sold per day since launch)
//   - Days until event
//   - Target sell-through for early-bird tier (default 30%)
//
// The service persists cutoff recommendations and allows promoters to
// accept, modify, or override the suggestion.
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable ML adapter — swap for real model in production */
export interface MlAdapter {
  predictCutoffDate(input: CutoffPredictionInput): Promise<CutoffPredictionOutput>;
}

export interface CutoffPredictionInput {
  eventId: string;
  eventDate: Date;
  launchDate: Date;
  ticketsSoldSinceLaunch: number;
  totalCapacity: number;
  earlyBirdTargetPct: number;     // e.g. 0.30 = 30% of capacity at EB price
  historicalVelocityPerDay: number | null; // null when no history
}

export interface CutoffPredictionOutput {
  recommendedCutoffDate: Date;
  confidenceScore: number;        // 0.0–1.0
  estimatedSellThroughAtCutoff: number; // fraction, e.g. 0.28
  reasoning: string;
}

export interface EarlyBirdCutoff {
  id: string;
  eventId: string;
  promoterId: string;
  recommendedCutoffDate: Date;
  acceptedCutoffDate: Date | null;
  status: 'pending' | 'accepted' | 'overridden' | 'expired';
  confidenceScore: number;
  estimatedSellThrough: number;
  reasoning: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CutoffRow {
  id: string;
  event_id: string;
  promoter_id: string;
  recommended_cutoff_date: string;
  accepted_cutoff_date: string | null;
  status: string;
  confidence_score: string;
  estimated_sell_through: string;
  reasoning: string;
  created_at: string;
  updated_at: string;
}

function mapCutoff(r: CutoffRow): EarlyBirdCutoff {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    recommendedCutoffDate: new Date(r.recommended_cutoff_date),
    acceptedCutoffDate: r.accepted_cutoff_date ? new Date(r.accepted_cutoff_date) : null,
    status: r.status as EarlyBirdCutoff['status'],
    confidenceScore: Number(r.confidence_score),
    estimatedSellThrough: Number(r.estimated_sell_through),
    reasoning: r.reasoning,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/**
 * Predict and store an Early Bird cutoff recommendation for an event.
 * If a recommendation already exists and is 'pending', overwrites it.
 */
export async function predictEarlyBirdCutoff(
  input: {
    eventId: string;
    promoterId: string;
    eventDate: Date;
    launchDate: Date;
    ticketsSoldSinceLaunch: number;
    totalCapacity: number;
    earlyBirdTargetPct?: number;
  },
  ml: MlAdapter,
  db: DbAdapter,
): Promise<EarlyBirdCutoff> {
  if (input.totalCapacity <= 0) throw new Error('VALIDATION_ERROR: totalCapacity must be positive');
  if (input.ticketsSoldSinceLaunch < 0) throw new Error('VALIDATION_ERROR: ticketsSoldSinceLaunch cannot be negative');
  if (input.eventDate <= input.launchDate) throw new Error('VALIDATION_ERROR: eventDate must be after launchDate');

  const targetPct = input.earlyBirdTargetPct ?? 0.30;

  // Compute sell velocity
  const daysSinceLaunch = Math.max(1, Math.floor(
    (Date.now() - input.launchDate.getTime()) / (1000 * 60 * 60 * 24),
  ));
  const velocityPerDay = input.ticketsSoldSinceLaunch / daysSinceLaunch;

  const prediction = await ml.predictCutoffDate({
    eventId: input.eventId,
    eventDate: input.eventDate,
    launchDate: input.launchDate,
    ticketsSoldSinceLaunch: input.ticketsSoldSinceLaunch,
    totalCapacity: input.totalCapacity,
    earlyBirdTargetPct: targetPct,
    historicalVelocityPerDay: velocityPerDay > 0 ? velocityPerDay : null,
  });

  const rows = await db.query<CutoffRow>(
    `INSERT INTO ml.early_bird_cutoffs
       (event_id, promoter_id, recommended_cutoff_date, status,
        confidence_score, estimated_sell_through, reasoning)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6)
     ON CONFLICT (event_id) DO UPDATE
       SET recommended_cutoff_date = EXCLUDED.recommended_cutoff_date,
           confidence_score = EXCLUDED.confidence_score,
           estimated_sell_through = EXCLUDED.estimated_sell_through,
           reasoning = EXCLUDED.reasoning,
           status = 'pending',
           updated_at = NOW()
     RETURNING *`,
    [
      input.eventId,
      input.promoterId,
      prediction.recommendedCutoffDate.toISOString(),
      prediction.confidenceScore,
      prediction.estimatedSellThroughAtCutoff,
      prediction.reasoning,
    ],
  );

  return mapCutoff(rows[0]);
}

/**
 * Promoter accepts the ML recommendation (possibly with a custom date).
 */
export async function acceptEarlyBirdCutoff(
  eventId: string,
  promoterId: string,
  customDate: Date | null,
  db: DbAdapter,
): Promise<EarlyBirdCutoff> {
  const existing = await db.query<CutoffRow>(
    `SELECT * FROM ml.early_bird_cutoffs WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );

  if (!existing[0]) throw new Error('CUTOFF_NOT_FOUND');
  if (existing[0].status !== 'pending') throw new Error(`INVALID_STATUS: ${existing[0].status}`);

  const acceptedDate = customDate ?? new Date(existing[0].recommended_cutoff_date);
  const status = customDate ? 'overridden' : 'accepted';

  const rows = await db.query<CutoffRow>(
    `UPDATE ml.early_bird_cutoffs
     SET accepted_cutoff_date = $3, status = $4, updated_at = NOW()
     WHERE event_id = $1 AND promoter_id = $2
     RETURNING *`,
    [eventId, promoterId, acceptedDate.toISOString(), status],
  );

  return mapCutoff(rows[0]);
}

/**
 * Get the current Early Bird cutoff recommendation for an event.
 */
export async function getEarlyBirdCutoff(
  eventId: string,
  db: DbAdapter,
): Promise<EarlyBirdCutoff | null> {
  const rows = await db.query<CutoffRow>(
    `SELECT * FROM ml.early_bird_cutoffs WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapCutoff(rows[0]) : null;
}

/**
 * Mark past-due 'pending' cutoffs as 'expired' (cron job).
 * Returns the number of records updated.
 */
export async function expireStaleRecommendations(
  db: DbAdapter,
): Promise<number> {
  const rows = await db.query<{ count: string }>(
    `UPDATE ml.early_bird_cutoffs
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND recommended_cutoff_date < NOW()
     RETURNING id`,
  );
  return rows.length;
}
