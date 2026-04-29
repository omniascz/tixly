// =============================================================================
// Real-Time Revenue Calculator — Dynamic Price/Capacity Impact
// Feature #40: Show revenue impact in admin UI when capacity/price changes
// All monetary values in halíře (100 = 1 CZK)
// =============================================================================

export interface RevenueProjection {
  id: string;
  eventId: string;
  promoterId: string;
  totalCapacity: number;
  currentSold: number;
  basePriceHellers: number;
  projectedRevenueHellers: number;
  worstCaseRevenueHellers?: number;
  midCaseRevenueHellers?: number;
  bestCaseRevenueHellers?: number;
  calculatedAt: string;
  updatedAt: string;
}

export interface RevenueImpact {
  baseRevenueHellers: number;
  newRevenueHellers: number;
  impactHellers: number;
  impactPercent: number;
}

export interface ScenarioResult {
  scenarioType: 'capacity_change' | 'price_change' | 'mixed';
  baseProjection: RevenueProjection;
  newProjection: RevenueProjection;
  impact: RevenueImpact;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface ProjectionRow {
  id: string;
  event_id: string;
  promoter_id: string;
  total_capacity: number;
  current_sold: number;
  base_price_hellers: number;
  projected_revenue_hellers: number;
  worst_case_revenue_hellers: number | null;
  mid_case_revenue_hellers: number | null;
  best_case_revenue_hellers: number | null;
  calculated_at: string;
  updated_at: string;
}

function mapProjection(row: ProjectionRow): RevenueProjection {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    totalCapacity: row.total_capacity,
    currentSold: row.current_sold,
    basePriceHellers: row.base_price_hellers,
    projectedRevenueHellers: row.projected_revenue_hellers,
    worstCaseRevenueHellers: row.worst_case_revenue_hellers || undefined,
    midCaseRevenueHellers: row.mid_case_revenue_hellers || undefined,
    bestCaseRevenueHellers: row.best_case_revenue_hellers || undefined,
    calculatedAt: row.calculated_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Calculate revenue impact when capacity changes.
 * Shows what revenue would be if capacity was different.
 */
export function simulateCapacityChange(
  currentCapacity: number,
  newCapacity: number,
  currentSold: number,
  basePriceHellers: number,
): RevenueImpact {
  // Calculate current revenue
  const currentRevenueHellers = currentSold * basePriceHellers;

  // Calculate how many tickets we could sell at new capacity
  const fillRatePercent = (currentSold / currentCapacity) * 100;
  const projectedSoldAtNewCapacity = Math.floor((newCapacity * fillRatePercent) / 100);
  const newRevenueHellers = projectedSoldAtNewCapacity * basePriceHellers;

  const impactHellers = newRevenueHellers - currentRevenueHellers;
  const impactPercent = (impactHellers / currentRevenueHellers) * 100;

  return {
    baseRevenueHellers: currentRevenueHellers,
    newRevenueHellers,
    impactHellers,
    impactPercent: Math.round(impactPercent * 100) / 100,
  };
}

/**
 * Calculate revenue impact when price changes.
 * Assumes lower demand at higher prices.
 */
export function simulatePriceChange(
  currentPriceHellers: number,
  newPriceHellers: number,
  currentSold: number,
  totalCapacity: number,
): RevenueImpact {
  // Current revenue
  const currentRevenueHellers = currentSold * currentPriceHellers;

  // Price elasticity: ~1% demand drop per 5% price increase
  const priceChangePercent = ((newPriceHellers - currentPriceHellers) / currentPriceHellers) * 100;
  const demandDropPercent = (Math.abs(priceChangePercent) / 5) * 1;
  const projectedSold = Math.floor(currentSold * (1 - demandDropPercent / 100));
  const cappedSold = Math.min(projectedSold, totalCapacity);

  const newRevenueHellers = cappedSold * newPriceHellers;

  const impactHellers = newRevenueHellers - currentRevenueHellers;
  const impactPercent = (impactHellers / currentRevenueHellers) * 100;

  return {
    baseRevenueHellers: currentRevenueHellers,
    newRevenueHellers,
    impactHellers,
    impactPercent: Math.round(impactPercent * 100) / 100,
  };
}

/**
 * Get current revenue projection for an event.
 */
export async function getRevenueProjection(
  eventId: string,
  db: DbAdapter,
): Promise<RevenueProjection | null> {
  const rows = await db.query<ProjectionRow>(
    `SELECT * FROM revenue.projections WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapProjection(rows[0]) : null;
}

/**
 * Update or create revenue projection for an event.
 */
export async function updateRevenueProjection(
  eventId: string,
  promoterId: string,
  totalCapacity: number,
  currentSold: number,
  basePriceHellers: number,
  db: DbAdapter,
): Promise<RevenueProjection> {
  const projectedRevenueHellers = currentSold * basePriceHellers;

  // Calculate scenario revenues (40%, 70%, 100% capacity)
  const worstCaseHellers = Math.floor((totalCapacity * 0.4) * basePriceHellers);
  const midCaseHellers = Math.floor((totalCapacity * 0.7) * basePriceHellers);
  const bestCaseHellers = totalCapacity * basePriceHellers;

  const rows = await db.query<ProjectionRow>(
    `INSERT INTO revenue.projections
       (event_id, promoter_id, total_capacity, current_sold, base_price_hellers,
        projected_revenue_hellers, worst_case_revenue_hellers, mid_case_revenue_hellers, best_case_revenue_hellers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (event_id)
     DO UPDATE SET
       total_capacity = $3,
       current_sold = $4,
       base_price_hellers = $5,
       projected_revenue_hellers = $6,
       worst_case_revenue_hellers = $7,
       mid_case_revenue_hellers = $8,
       best_case_revenue_hellers = $9,
       updated_at = NOW()
     RETURNING *`,
    [
      eventId,
      promoterId,
      totalCapacity,
      currentSold,
      basePriceHellers,
      projectedRevenueHellers,
      worstCaseHellers,
      midCaseHellers,
      bestCaseHellers,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: projection update failed');
  return mapProjection(rows[0]);
}

/**
 * Log a scenario calculation to history for audit trail.
 */
export async function logRevenueScenario(
  eventId: string,
  scenarioType: 'capacity_change' | 'price_change' | 'mixed',
  baseRevenueHellers: number,
  newRevenueHellers: number,
  parameters: Record<string, unknown>,
  db: DbAdapter,
): Promise<void> {
  const impactHellers = newRevenueHellers - baseRevenueHellers;
  const impactPercent = (impactHellers / baseRevenueHellers) * 100;

  await db.execute(
    `INSERT INTO revenue.impact_history
       (event_id, scenario_type, base_revenue_hellers, new_revenue_hellers, impact_hellers, impact_percent, parameters)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      eventId,
      scenarioType,
      baseRevenueHellers,
      newRevenueHellers,
      impactHellers,
      impactPercent,
      JSON.stringify(parameters),
    ],
  );
}

/**
 * Get all scenario calculations for an event (last 100).
 */
export async function getScenarioHistory(
  eventId: string,
  db: DbAdapter,
): Promise<Array<{
  scenarioType: string;
  baseRevenueHellers: number;
  newRevenueHellers: number;
  impactHellers: number;
  impactPercent: number;
  calculatedAt: string;
}>> {
  const rows = await db.query<{
    scenario_type: string;
    base_revenue_hellers: number;
    new_revenue_hellers: number;
    impact_hellers: number;
    impact_percent: number;
    calculated_at: string;
  }>(
    `SELECT scenario_type, base_revenue_hellers, new_revenue_hellers, impact_hellers, impact_percent, calculated_at
     FROM revenue.impact_history
     WHERE event_id = $1
     ORDER BY calculated_at DESC
     LIMIT 100`,
    [eventId],
  );

  return rows.map((row) => ({
    scenarioType: row.scenario_type,
    baseRevenueHellers: row.base_revenue_hellers,
    newRevenueHellers: row.new_revenue_hellers,
    impactHellers: row.impact_hellers,
    impactPercent: row.impact_percent,
    calculatedAt: row.calculated_at,
  }));
}

/**
 * Calculate impact and return formatted result for UI.
 */
export function formatRevenueImpact(impact: RevenueImpact): {
  baseRevenue: string;
  newRevenue: string;
  impactAmount: string;
  impactPercent: string;
  trend: 'up' | 'down' | 'neutral';
} {
  const czk = (hellers: number) => `${(hellers / 100).toFixed(2)} CZK`;

  const trend: 'up' | 'down' | 'neutral' =
    impact.impactHellers > 0 ? 'up' : impact.impactHellers < 0 ? 'down' : 'neutral';

  return {
    baseRevenue: czk(impact.baseRevenueHellers),
    newRevenue: czk(impact.newRevenueHellers),
    impactAmount: czk(Math.abs(impact.impactHellers)),
    impactPercent: `${Math.abs(impact.impactPercent).toFixed(1)}%`,
    trend,
  };
}

/**
 * Get 3-scenario projection for event (worst/mid/best case).
 */
export async function getScenarioProjections(
  eventId: string,
  db: DbAdapter,
): Promise<{
  current: number;
  worst: number;
  mid: number;
  best: number;
} | null> {
  const projection = await getRevenueProjection(eventId, db);
  if (!projection) return null;

  return {
    current: projection.projectedRevenueHellers,
    worst: projection.worstCaseRevenueHellers || 0,
    mid: projection.midCaseRevenueHellers || 0,
    best: projection.bestCaseRevenueHellers || 0,
  };
}
