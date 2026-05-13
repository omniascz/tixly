// =============================================================================
// Resale Price Prediction — Feature #125
//
// ML-based prediction of fair resale price for a ticket.
// Uses injectable MlAdapter so the service is testable without a live model.
//
// The ML model considers:
//   - Original face value
//   - Current demand score (0.0–1.0, derived from event popularity signals)
//   - Days until event
//   - Current secondary market listings for the same event
//   - Historical resale price ratio for similar events
//
// The service stores predictions and allows sellers to list at or below the
// predicted ceiling price.
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable ML adapter */
export interface MlAdapter {
  predictResalePrice(input: ResalePricePredictionInput): Promise<ResalePricePredictionOutput>;
}

export interface ResalePricePredictionInput {
  ticketId: string;
  eventId: string;
  faceValueHalire: number;        // original price in halíře
  daysUntilEvent: number;
  demandScore: number;            // 0.0–1.0
  activeListingsCount: number;    // current secondary market supply
  historicalResaleRatio: number | null; // null when no history (ratio vs face value)
}

export interface ResalePricePredictionOutput {
  predictedPriceHalire: number;   // recommended fair price in halíře
  ceilingPriceHalire: number;     // max acceptable price (anti-scalping)
  floorPriceHalire: number;       // minimum (protects seller from loss)
  confidenceScore: number;        // 0.0–1.0
  reasoning: string;
}

export interface ResalePricePrediction {
  id: string;
  ticketId: string;
  eventId: string;
  faceValueHalire: number;
  predictedPriceHalire: number;
  ceilingPriceHalire: number;
  floorPriceHalire: number;
  confidenceScore: number;
  reasoning: string;
  createdAt: Date;
  updatedAt: Date;
}

interface PredictionRow {
  id: string;
  ticket_id: string;
  event_id: string;
  face_value_halire: string;
  predicted_price_halire: string;
  ceiling_price_halire: string;
  floor_price_halire: string;
  confidence_score: string;
  reasoning: string;
  created_at: string;
  updated_at: string;
}

function mapPrediction(r: PredictionRow): ResalePricePrediction {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    eventId: r.event_id,
    faceValueHalire: Number(r.face_value_halire),
    predictedPriceHalire: Number(r.predicted_price_halire),
    ceilingPriceHalire: Number(r.ceiling_price_halire),
    floorPriceHalire: Number(r.floor_price_halire),
    confidenceScore: Number(r.confidence_score),
    reasoning: r.reasoning,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/**
 * Predict a fair resale price for a ticket.
 * Upserts: if a prediction already exists for this ticket, refreshes it.
 */
export async function predictResalePrice(
  input: {
    ticketId: string;
    eventId: string;
    faceValueHalire: number;
    eventDate: Date;
    activeListingsCount: number;
    demandScore: number;
    historicalResaleRatio?: number | null;
  },
  ml: MlAdapter,
  db: DbAdapter,
): Promise<ResalePricePrediction> {
  if (input.faceValueHalire <= 0) throw new Error('VALIDATION_ERROR: faceValueHalire must be positive');
  if (input.demandScore < 0 || input.demandScore > 1) throw new Error('VALIDATION_ERROR: demandScore must be between 0 and 1');
  if (input.activeListingsCount < 0) throw new Error('VALIDATION_ERROR: activeListingsCount cannot be negative');

  const daysUntilEvent = Math.max(0, Math.ceil(
    (input.eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  ));

  const prediction = await ml.predictResalePrice({
    ticketId: input.ticketId,
    eventId: input.eventId,
    faceValueHalire: input.faceValueHalire,
    daysUntilEvent,
    demandScore: input.demandScore,
    activeListingsCount: input.activeListingsCount,
    historicalResaleRatio: input.historicalResaleRatio ?? null,
  });

  if (prediction.ceilingPriceHalire < prediction.predictedPriceHalire) {
    throw new Error('ML_ERROR: ceilingPriceHalire must be >= predictedPriceHalire');
  }
  if (prediction.floorPriceHalire > prediction.predictedPriceHalire) {
    throw new Error('ML_ERROR: floorPriceHalire must be <= predictedPriceHalire');
  }

  const rows = await db.query<PredictionRow>(
    `INSERT INTO ml.resale_price_predictions
       (ticket_id, event_id, face_value_halire,
        predicted_price_halire, ceiling_price_halire, floor_price_halire,
        confidence_score, reasoning)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (ticket_id) DO UPDATE
       SET event_id = EXCLUDED.event_id,
           face_value_halire = EXCLUDED.face_value_halire,
           predicted_price_halire = EXCLUDED.predicted_price_halire,
           ceiling_price_halire = EXCLUDED.ceiling_price_halire,
           floor_price_halire = EXCLUDED.floor_price_halire,
           confidence_score = EXCLUDED.confidence_score,
           reasoning = EXCLUDED.reasoning,
           updated_at = NOW()
     RETURNING *`,
    [
      input.ticketId,
      input.eventId,
      input.faceValueHalire,
      prediction.predictedPriceHalire,
      prediction.ceilingPriceHalire,
      prediction.floorPriceHalire,
      prediction.confidenceScore,
      prediction.reasoning,
    ],
  );

  return mapPrediction(rows[0]);
}

/**
 * Get the current resale price prediction for a ticket.
 */
export async function getResalePricePrediction(
  ticketId: string,
  db: DbAdapter,
): Promise<ResalePricePrediction | null> {
  const rows = await db.query<PredictionRow>(
    `SELECT * FROM ml.resale_price_predictions WHERE ticket_id = $1`,
    [ticketId],
  );
  return rows[0] ? mapPrediction(rows[0]) : null;
}

/**
 * Validate whether a proposed listing price is within acceptable bounds.
 */
export async function validateListingPrice(
  ticketId: string,
  proposedPriceHalire: number,
  db: DbAdapter,
): Promise<{ valid: boolean; reason: string | null }> {
  const prediction = await getResalePricePrediction(ticketId, db);

  if (!prediction) {
    return { valid: true, reason: null }; // no prediction yet, allow
  }
  if (proposedPriceHalire > prediction.ceilingPriceHalire) {
    return {
      valid: false,
      reason: `Price exceeds ceiling of ${prediction.ceilingPriceHalire} halíře`,
    };
  }
  if (proposedPriceHalire < prediction.floorPriceHalire) {
    return {
      valid: false,
      reason: `Price below floor of ${prediction.floorPriceHalire} halíře`,
    };
  }
  return { valid: true, reason: null };
}

/**
 * Get all predictions for an event (for market overview).
 */
export async function getEventResalePredictions(
  eventId: string,
  db: DbAdapter,
): Promise<ResalePricePrediction[]> {
  const rows = await db.query<PredictionRow>(
    `SELECT * FROM ml.resale_price_predictions WHERE event_id = $1 ORDER BY predicted_price_halire DESC`,
    [eventId],
  );
  return rows.map(mapPrediction);
}
