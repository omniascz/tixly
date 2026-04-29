// =============================================================================
// Sell-Through Rate Forecast — Feature #126
//
// ML-based prediction of the final sell-through rate for an event.
// Uses injectable MlAdapter so the service is testable without a live model.
//
// The ML model considers:
//   - Current sell-through rate (tickets sold / capacity)
//   - Current sales velocity (tickets/day)
//   - Days until event
//   - Historical sell-through for similar events (genre, venue size, day-of-week)
//   - Marketing campaign spend (optional signal)
//
// Forecasts are stored per event and refreshed on demand (e.g. daily cron).
// Promoters can view the forecast to decide on promotions, discounts, etc.
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

/** Injectable ML adapter */
export interface MlAdapter {
  forecastSellThrough(input: SellThroughForecastInput): Promise<SellThroughForecastOutput>;
}

export interface SellThroughForecastInput {
  eventId: string;
  totalCapacity: number;
  ticketsSold: number;
  currentSellThroughRate: number;  // fraction: ticketsSold / totalCapacity
  salesVelocityPerDay: number;     // average over last 7 days
  daysUntilEvent: number;
  historicalAvgSellThrough: number | null; // null when no history
  marketingSpendCzk: number | null;        // null when unknown
}

export interface SellThroughForecastOutput {
  forecastedSellThroughRate: number;  // fraction 0.0–1.0
  lowerBound: number;                 // 80% confidence interval lower
  upperBound: number;                 // 80% confidence interval upper
  confidenceScore: number;            // 0.0–1.0
  riskLevel: 'low' | 'medium' | 'high'; // low >= 0.80, medium >= 0.50, high < 0.50
  reasoning: string;
}

export interface SellThroughForecast {
  id: string;
  eventId: string;
  totalCapacity: number;
  ticketsSold: number;
  currentSellThroughRate: number;
  forecastedSellThroughRate: number;
  lowerBound: number;
  upperBound: number;
  confidenceScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasoning: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ForecastRow {
  id: string;
  event_id: string;
  total_capacity: string;
  tickets_sold: string;
  current_sell_through_rate: string;
  forecasted_sell_through_rate: string;
  lower_bound: string;
  upper_bound: string;
  confidence_score: string;
  risk_level: string;
  reasoning: string;
  created_at: string;
  updated_at: string;
}

function mapForecast(r: ForecastRow): SellThroughForecast {
  return {
    id: r.id,
    eventId: r.event_id,
    totalCapacity: Number(r.total_capacity),
    ticketsSold: Number(r.tickets_sold),
    currentSellThroughRate: Number(r.current_sell_through_rate),
    forecastedSellThroughRate: Number(r.forecasted_sell_through_rate),
    lowerBound: Number(r.lower_bound),
    upperBound: Number(r.upper_bound),
    confidenceScore: Number(r.confidence_score),
    riskLevel: r.risk_level as SellThroughForecast['riskLevel'],
    reasoning: r.reasoning,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/**
 * Generate (or refresh) a sell-through forecast for an event.
 * Upserts on event_id — refreshing existing forecast each time.
 */
export async function forecastSellThrough(
  input: {
    eventId: string;
    totalCapacity: number;
    ticketsSold: number;
    eventDate: Date;
    salesVelocityPerDay: number;
    historicalAvgSellThrough?: number | null;
    marketingSpendCzk?: number | null;
  },
  ml: MlAdapter,
  db: DbAdapter,
): Promise<SellThroughForecast> {
  if (input.totalCapacity <= 0) throw new Error('VALIDATION_ERROR: totalCapacity must be positive');
  if (input.ticketsSold < 0) throw new Error('VALIDATION_ERROR: ticketsSold cannot be negative');
  if (input.ticketsSold > input.totalCapacity) throw new Error('VALIDATION_ERROR: ticketsSold cannot exceed totalCapacity');
  if (input.salesVelocityPerDay < 0) throw new Error('VALIDATION_ERROR: salesVelocityPerDay cannot be negative');

  const currentSellThroughRate = input.ticketsSold / input.totalCapacity;
  const daysUntilEvent = Math.max(0, Math.ceil(
    (input.eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  ));

  const forecast = await ml.forecastSellThrough({
    eventId: input.eventId,
    totalCapacity: input.totalCapacity,
    ticketsSold: input.ticketsSold,
    currentSellThroughRate,
    salesVelocityPerDay: input.salesVelocityPerDay,
    daysUntilEvent,
    historicalAvgSellThrough: input.historicalAvgSellThrough ?? null,
    marketingSpendCzk: input.marketingSpendCzk ?? null,
  });

  if (forecast.lowerBound > forecast.forecastedSellThroughRate) {
    throw new Error('ML_ERROR: lowerBound must be <= forecastedSellThroughRate');
  }
  if (forecast.upperBound < forecast.forecastedSellThroughRate) {
    throw new Error('ML_ERROR: upperBound must be >= forecastedSellThroughRate');
  }

  const rows = await db.query<ForecastRow>(
    `INSERT INTO ml.sell_through_forecasts
       (event_id, total_capacity, tickets_sold, current_sell_through_rate,
        forecasted_sell_through_rate, lower_bound, upper_bound,
        confidence_score, risk_level, reasoning)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (event_id) DO UPDATE
       SET total_capacity = EXCLUDED.total_capacity,
           tickets_sold = EXCLUDED.tickets_sold,
           current_sell_through_rate = EXCLUDED.current_sell_through_rate,
           forecasted_sell_through_rate = EXCLUDED.forecasted_sell_through_rate,
           lower_bound = EXCLUDED.lower_bound,
           upper_bound = EXCLUDED.upper_bound,
           confidence_score = EXCLUDED.confidence_score,
           risk_level = EXCLUDED.risk_level,
           reasoning = EXCLUDED.reasoning,
           updated_at = NOW()
     RETURNING *`,
    [
      input.eventId,
      input.totalCapacity,
      input.ticketsSold,
      currentSellThroughRate,
      forecast.forecastedSellThroughRate,
      forecast.lowerBound,
      forecast.upperBound,
      forecast.confidenceScore,
      forecast.riskLevel,
      forecast.reasoning,
    ],
  );

  return mapForecast(rows[0]);
}

/**
 * Get the current sell-through forecast for an event.
 */
export async function getSellThroughForecast(
  eventId: string,
  db: DbAdapter,
): Promise<SellThroughForecast | null> {
  const rows = await db.query<ForecastRow>(
    `SELECT * FROM ml.sell_through_forecasts WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapForecast(rows[0]) : null;
}

/**
 * Get all high-risk events (forecasted sell-through < 50%) for a promoter's dashboard.
 */
export async function getHighRiskForecasts(
  promoterId: string,
  db: DbAdapter,
): Promise<SellThroughForecast[]> {
  const rows = await db.query<ForecastRow>(
    `SELECT stf.*
     FROM ml.sell_through_forecasts stf
     JOIN events e ON e.id = stf.event_id
     WHERE e.promoter_id = $1
       AND stf.risk_level = 'high'
     ORDER BY stf.forecasted_sell_through_rate ASC`,
    [promoterId],
  );
  return rows.map(mapForecast);
}
