// =============================================================================
// Tour / Series Management Service
// Feature #27: Group related events (tours, multi-day festivals, series)
// Enables cross-event reporting, bulk operations, and shared configs.
// =============================================================================

export interface Series {
  id: string;
  promoterId: string;
  name: string;
  seriesType: 'tour' | 'festival' | 'series' | 'conference';
  description?: string;
  artworkUrl?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SeriesEvent {
  id: string;
  seriesId: string;
  eventId: string;
  legNumber?: number;
  isHeadline: boolean;
  customName?: string;
  createdAt: string;
}

export interface SeriesMetrics {
  seriesId: string;
  totalEvents: number;
  totalCapacity: number;
  totalSold: number;
  totalRevenueHellers: bigint;
  avgOccupancyPct: number;
  lastCalculatedAt: string;
}

export interface CreateSeriesInput {
  name: string;
  seriesType: 'tour' | 'festival' | 'series' | 'conference';
  description?: string;
  artworkUrl?: string;
  startDate?: string;
  endDate?: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface SeriesRow {
  id: string;
  promoter_id: string;
  name: string;
  series_type: string;
  description: string | null;
  artwork_url: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface SeriesEventRow {
  id: string;
  series_id: string;
  event_id: string;
  leg_number: number | null;
  is_headline: boolean;
  custom_name: string | null;
  created_at: string;
}

interface SeriesMetricsRow {
  series_id: string;
  total_events: number;
  total_capacity: number;
  total_sold: number;
  total_revenue_hellers: string;
  avg_occupancy_pct: string;
  last_calculated_at: string;
}

function mapSeries(row: SeriesRow): Series {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    seriesType: row.series_type as any,
    description: row.description || undefined,
    artworkUrl: row.artwork_url || undefined,
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSeriesEvent(row: SeriesEventRow): SeriesEvent {
  return {
    id: row.id,
    seriesId: row.series_id,
    eventId: row.event_id,
    legNumber: row.leg_number || undefined,
    isHeadline: row.is_headline,
    customName: row.custom_name || undefined,
    createdAt: row.created_at,
  };
}

/**
 * Create a new tour / series.
 */
export async function createSeries(
  promoterId: string,
  input: CreateSeriesInput,
  db: DbAdapter,
): Promise<Series> {
  if (!input.name) {
    throw new Error('VALIDATION_ERROR: name required');
  }

  const rows = await db.query<SeriesRow>(
    `INSERT INTO tours.series
       (promoter_id, name, series_type, description, artwork_url, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      promoterId,
      input.name,
      input.seriesType,
      input.description || null,
      input.artworkUrl || null,
      input.startDate || null,
      input.endDate || null,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: series creation failed');
  return mapSeries(rows[0]);
}

/**
 * Get series by ID (tenant-scoped).
 */
export async function getSeries(
  seriesId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<Series | null> {
  const rows = await db.query<SeriesRow>(
    `SELECT * FROM tours.series WHERE id = $1 AND promoter_id = $2`,
    [seriesId, promoterId],
  );
  return rows[0] ? mapSeries(rows[0]) : null;
}

/**
 * List all series for a promoter.
 */
export async function listSeries(
  promoterId: string,
  db: DbAdapter,
): Promise<Series[]> {
  const rows = await db.query<SeriesRow>(
    `SELECT * FROM tours.series
     WHERE promoter_id = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [promoterId],
  );
  return rows.map(mapSeries);
}

/**
 * Add an event to a tour/series (as a tour leg).
 */
export async function addEventToSeries(
  seriesId: string,
  eventId: string,
  options: {
    legNumber?: number;
    isHeadline?: boolean;
    customName?: string;
  },
  db: DbAdapter,
): Promise<SeriesEvent> {
  const rows = await db.query<SeriesEventRow>(
    `INSERT INTO tours.series_events
       (series_id, event_id, leg_number, is_headline, custom_name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (series_id, event_id)
     DO UPDATE SET
       leg_number = COALESCE($3, series_events.leg_number),
       is_headline = COALESCE($4, series_events.is_headline),
       custom_name = COALESCE($5, series_events.custom_name)
     RETURNING *`,
    [
      seriesId,
      eventId,
      options.legNumber || null,
      options.isHeadline ?? false,
      options.customName || null,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: event addition failed');
  return mapSeriesEvent(rows[0]);
}

/**
 * Remove an event from a series.
 */
export async function removeEventFromSeries(
  seriesId: string,
  eventId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM tours.series_events WHERE series_id = $1 AND event_id = $2`,
    [seriesId, eventId],
  );
}

/**
 * Get all events in a series, ordered by leg number.
 */
export async function getSeriesEvents(
  seriesId: string,
  db: DbAdapter,
): Promise<SeriesEvent[]> {
  const rows = await db.query<SeriesEventRow>(
    `SELECT * FROM tours.series_events
     WHERE series_id = $1
     ORDER BY leg_number ASC NULLS LAST, created_at ASC`,
    [seriesId],
  );
  return rows.map(mapSeriesEvent);
}

/**
 * Calculate and update series-level metrics.
 * Aggregates across all events in the series.
 */
export async function refreshSeriesMetrics(
  seriesId: string,
  db: DbAdapter,
): Promise<SeriesMetrics> {
  const metricsRows = await db.query<SeriesMetricsRow>(
    `INSERT INTO tours.series_metrics
       (series_id, total_events, total_capacity, total_sold, total_revenue_hellers, avg_occupancy_pct)
     SELECT
       $1 AS series_id,
       COUNT(DISTINCT se.event_id) AS total_events,
       COALESCE(SUM(e.capacity), 0) AS total_capacity,
       COALESCE(SUM(e.sold_count), 0) AS total_sold,
       COALESCE(SUM(e.revenue_hellers), 0) AS total_revenue_hellers,
       CASE WHEN SUM(e.capacity) > 0
         THEN (SUM(e.sold_count)::DECIMAL / SUM(e.capacity)) * 100
         ELSE 0
       END AS avg_occupancy_pct
     FROM tours.series_events se
     LEFT JOIN catalog.events e ON e.id = se.event_id
     WHERE se.series_id = $1
     ON CONFLICT (series_id)
     DO UPDATE SET
       total_events = EXCLUDED.total_events,
       total_capacity = EXCLUDED.total_capacity,
       total_sold = EXCLUDED.total_sold,
       total_revenue_hellers = EXCLUDED.total_revenue_hellers,
       avg_occupancy_pct = EXCLUDED.avg_occupancy_pct,
       last_calculated_at = NOW()
     RETURNING *`,
    [seriesId],
  );

  if (!metricsRows[0]) throw new Error('INTERNAL_ERROR: metrics refresh failed');

  const r = metricsRows[0];
  return {
    seriesId: r.series_id,
    totalEvents: r.total_events,
    totalCapacity: r.total_capacity,
    totalSold: r.total_sold,
    totalRevenueHellers: BigInt(r.total_revenue_hellers),
    avgOccupancyPct: Number(r.avg_occupancy_pct),
    lastCalculatedAt: r.last_calculated_at,
  };
}

/**
 * Get series metrics (cached).
 */
export async function getSeriesMetrics(
  seriesId: string,
  db: DbAdapter,
): Promise<SeriesMetrics | null> {
  const rows = await db.query<SeriesMetricsRow>(
    `SELECT * FROM tours.series_metrics WHERE series_id = $1`,
    [seriesId],
  );

  if (!rows[0]) return null;
  const r = rows[0];
  return {
    seriesId: r.series_id,
    totalEvents: r.total_events,
    totalCapacity: r.total_capacity,
    totalSold: r.total_sold,
    totalRevenueHellers: BigInt(r.total_revenue_hellers),
    avgOccupancyPct: Number(r.avg_occupancy_pct),
    lastCalculatedAt: r.last_calculated_at,
  };
}

/**
 * Update series details (tenant-scoped).
 */
export async function updateSeries(
  seriesId: string,
  promoterId: string,
  updates: Partial<CreateSeriesInput>,
  db: DbAdapter,
): Promise<Series> {
  const setClauses: string[] = [];
  const params: unknown[] = [seriesId, promoterId];

  if (updates.name !== undefined) {
    setClauses.push(`name = $${params.length + 1}`);
    params.push(updates.name);
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${params.length + 1}`);
    params.push(updates.description || null);
  }
  if (updates.artworkUrl !== undefined) {
    setClauses.push(`artwork_url = $${params.length + 1}`);
    params.push(updates.artworkUrl || null);
  }
  if (updates.startDate !== undefined) {
    setClauses.push(`start_date = $${params.length + 1}`);
    params.push(updates.startDate || null);
  }
  if (updates.endDate !== undefined) {
    setClauses.push(`end_date = $${params.length + 1}`);
    params.push(updates.endDate || null);
  }

  if (setClauses.length === 0) {
    throw new Error('VALIDATION_ERROR: no fields to update');
  }
  setClauses.push(`updated_at = NOW()`);

  const rows = await db.query<SeriesRow>(
    `UPDATE tours.series
     SET ${setClauses.join(', ')}
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    params,
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: series not found or update failed');
  return mapSeries(rows[0]);
}

/**
 * Delete a series (tenant-scoped, soft delete via is_active).
 */
export async function deleteSeries(
  seriesId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE tours.series SET is_active = false WHERE id = $1 AND promoter_id = $2`,
    [seriesId, promoterId],
  );
}
