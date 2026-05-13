// =============================================================================
// Flex Plans Service — Custom Event Bundle Builder
// Feature #41: Season-pass holders assemble bundles from event pools
//
// Flow:
//   1. Promoter creates a FlexCatalog (e.g. "Pick 10 from 20 matches", 4990 CZK)
//   2. Promoter adds events to the catalog pool
//   3. Buyer purchases the plan → status 'pending_selection'
//   4. Buyer calls selectEvents() to choose their preferred events (up to select_count)
//   5. Once selections_locked = true, tickets are issued per selected event
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface FlexCatalog {
  id: string;
  promoterId: string;
  name: string;
  description: string | null;
  selectCount: number;
  priceHellers: number;
  currency: string;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlexCatalogEvent {
  id: string;
  catalogId: string;
  eventId: string;
  ticketTypeId: string | null;
  displayOrder: number;
}

export interface FlexPlan {
  id: string;
  catalogId: string;
  userId: string;
  promoterId: string;
  status: 'pending_selection' | 'active' | 'expired' | 'cancelled';
  paymentId: string | null;
  pricePaidHellers: number;
  selectionsLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlexPlanSelection {
  id: string;
  planId: string;
  catalogEventId: string;
  eventId: string;
  ticketId: string | null;
  selectedAt: string;
}

interface CatalogRow {
  id: string;
  promoter_id: string;
  name: string;
  description: string | null;
  select_count: number;
  price_hellers: number;
  currency: string;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface CatalogEventRow {
  id: string;
  catalog_id: string;
  event_id: string;
  ticket_type_id: string | null;
  display_order: number;
}

interface PlanRow {
  id: string;
  catalog_id: string;
  user_id: string;
  promoter_id: string;
  status: string;
  payment_id: string | null;
  price_paid_hellers: number;
  selections_locked: boolean;
  created_at: string;
  updated_at: string;
}

interface SelectionRow {
  id: string;
  plan_id: string;
  catalog_event_id: string;
  event_id: string;
  ticket_id: string | null;
  selected_at: string;
}

function mapCatalog(r: CatalogRow): FlexCatalog {
  return {
    id: r.id,
    promoterId: r.promoter_id,
    name: r.name,
    description: r.description,
    selectCount: r.select_count,
    priceHellers: r.price_hellers,
    currency: r.currency,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapCatalogEvent(r: CatalogEventRow): FlexCatalogEvent {
  return {
    id: r.id,
    catalogId: r.catalog_id,
    eventId: r.event_id,
    ticketTypeId: r.ticket_type_id,
    displayOrder: r.display_order,
  };
}

function mapPlan(r: PlanRow): FlexPlan {
  return {
    id: r.id,
    catalogId: r.catalog_id,
    userId: r.user_id,
    promoterId: r.promoter_id,
    status: r.status as FlexPlan['status'],
    paymentId: r.payment_id,
    pricePaidHellers: r.price_paid_hellers,
    selectionsLocked: r.selections_locked,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapSelection(r: SelectionRow): FlexPlanSelection {
  return {
    id: r.id,
    planId: r.plan_id,
    catalogEventId: r.catalog_event_id,
    eventId: r.event_id,
    ticketId: r.ticket_id,
    selectedAt: r.selected_at,
  };
}

/**
 * Create a new Flex Catalog (bundle offer).
 */
export async function createFlexCatalog(
  promoterId: string,
  input: {
    name: string;
    description?: string;
    selectCount: number;
    priceHellers: number;
    currency?: string;
    validFrom?: string;
    validUntil?: string;
  },
  db: DbAdapter,
): Promise<FlexCatalog> {
  if (!input.name.trim()) {
    throw new Error('VALIDATION_ERROR: name is required');
  }
  if (input.selectCount < 1) {
    throw new Error('VALIDATION_ERROR: selectCount must be at least 1');
  }
  if (input.priceHellers < 0) {
    throw new Error('VALIDATION_ERROR: price cannot be negative');
  }

  const rows = await db.query<CatalogRow>(
    `INSERT INTO flex_plans.flex_catalogs
       (promoter_id, name, description, select_count, price_hellers, currency, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      promoterId,
      input.name,
      input.description ?? null,
      input.selectCount,
      input.priceHellers,
      input.currency ?? 'CZK',
      input.validFrom ?? null,
      input.validUntil ?? null,
    ],
  );

  return mapCatalog(rows[0]);
}

/**
 * Add an event to a catalog's pool.
 */
export async function addEventToCatalog(
  catalogId: string,
  eventId: string,
  ticketTypeId: string | null,
  displayOrder: number,
  db: DbAdapter,
): Promise<FlexCatalogEvent> {
  const rows = await db.query<CatalogEventRow>(
    `INSERT INTO flex_plans.flex_catalog_events (catalog_id, event_id, ticket_type_id, display_order)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (catalog_id, event_id) DO UPDATE SET
       ticket_type_id = EXCLUDED.ticket_type_id,
       display_order = EXCLUDED.display_order
     RETURNING *`,
    [catalogId, eventId, ticketTypeId, displayOrder],
  );
  return mapCatalogEvent(rows[0]);
}

/**
 * Get a catalog by ID.
 */
export async function getFlexCatalog(catalogId: string, db: DbAdapter): Promise<FlexCatalog | null> {
  const rows = await db.query<CatalogRow>(
    `SELECT * FROM flex_plans.flex_catalogs WHERE id = $1`,
    [catalogId],
  );
  return rows[0] ? mapCatalog(rows[0]) : null;
}

/**
 * List all active catalogs for a promoter.
 */
export async function listFlexCatalogs(promoterId: string, db: DbAdapter): Promise<FlexCatalog[]> {
  const rows = await db.query<CatalogRow>(
    `SELECT * FROM flex_plans.flex_catalogs WHERE promoter_id = $1 ORDER BY created_at DESC`,
    [promoterId],
  );
  return rows.map(mapCatalog);
}

/**
 * Get all events in a catalog pool (for buyer to browse and pick).
 */
export async function getCatalogEvents(catalogId: string, db: DbAdapter): Promise<FlexCatalogEvent[]> {
  const rows = await db.query<CatalogEventRow>(
    `SELECT * FROM flex_plans.flex_catalog_events WHERE catalog_id = $1 ORDER BY display_order ASC`,
    [catalogId],
  );
  return rows.map(mapCatalogEvent);
}

/**
 * Purchase a flex plan. Buyer pays → plan created in 'pending_selection'.
 */
export async function purchaseFlexPlan(
  userId: string,
  catalogId: string,
  paymentId: string,
  db: DbAdapter,
): Promise<FlexPlan> {
  const catalog = await getFlexCatalog(catalogId, db);
  if (!catalog) throw new Error('CATALOG_NOT_FOUND');
  if (!catalog.isActive) throw new Error('CATALOG_INACTIVE');

  const rows = await db.query<PlanRow>(
    `INSERT INTO flex_plans.flex_plans
       (catalog_id, user_id, promoter_id, status, payment_id, price_paid_hellers)
     VALUES ($1, $2, $3, 'pending_selection', $4, $5)
     RETURNING *`,
    [catalogId, userId, catalog.promoterId, paymentId, catalog.priceHellers],
  );

  return mapPlan(rows[0]);
}

/**
 * Buyer selects their preferred events from the catalog pool.
 * Selection count must match catalog.selectCount exactly.
 * Can only select once (before lock).
 */
export async function selectEvents(
  planId: string,
  userId: string,
  catalogEventIds: string[],
  db: DbAdapter,
): Promise<FlexPlanSelection[]> {
  return db.transaction(async (tx) => {
    const plans = await tx.query<PlanRow>(
      `SELECT * FROM flex_plans.flex_plans WHERE id = $1 AND user_id = $2`,
      [planId, userId],
    );

    if (!plans[0]) throw new Error('PLAN_NOT_FOUND');
    const plan = plans[0];

    if (plan.selections_locked) {
      throw new Error('SELECTIONS_LOCKED: event choices are already finalized');
    }

    const catalog = await getFlexCatalog(plan.catalog_id, tx);
    if (!catalog) throw new Error('CATALOG_NOT_FOUND');

    if (catalogEventIds.length !== catalog.selectCount) {
      throw new Error(
        `VALIDATION_ERROR: must select exactly ${catalog.selectCount} events, got ${catalogEventIds.length}`,
      );
    }

    // Validate all IDs belong to this catalog
    const validEvents = await tx.query<CatalogEventRow>(
      `SELECT id FROM flex_plans.flex_catalog_events WHERE catalog_id = $1 AND id = ANY($2::uuid[])`,
      [plan.catalog_id, catalogEventIds],
    );

    if (validEvents.length !== catalogEventIds.length) {
      throw new Error('VALIDATION_ERROR: one or more event IDs do not belong to this catalog');
    }

    // Clear any previous selections
    await tx.execute(
      `DELETE FROM flex_plans.flex_plan_selections WHERE plan_id = $1`,
      [planId],
    );

    // Insert new selections
    const selections: FlexPlanSelection[] = [];
    for (const catalogEventId of catalogEventIds) {
      const catalogEvent = validEvents.find((e) => e.id === catalogEventId);
      const rows = await tx.query<SelectionRow>(
        `INSERT INTO flex_plans.flex_plan_selections (plan_id, catalog_event_id, event_id)
         SELECT $1, ce.id, ce.event_id
         FROM flex_plans.flex_catalog_events ce
         WHERE ce.id = $2
         RETURNING *, (SELECT event_id FROM flex_plans.flex_catalog_events WHERE id = $2) AS event_id`,
        [planId, catalogEventId],
      );
      if (rows[0]) selections.push(mapSelection(rows[0]));
    }

    // Lock selections and activate plan
    await tx.execute(
      `UPDATE flex_plans.flex_plans
       SET selections_locked = true, status = 'active', updated_at = NOW()
       WHERE id = $1`,
      [planId],
    );

    return selections;
  });
}

/**
 * Get a flex plan with its selections.
 */
export async function getFlexPlan(planId: string, userId: string, db: DbAdapter): Promise<FlexPlan | null> {
  const rows = await db.query<PlanRow>(
    `SELECT * FROM flex_plans.flex_plans WHERE id = $1 AND user_id = $2`,
    [planId, userId],
  );
  return rows[0] ? mapPlan(rows[0]) : null;
}

/**
 * Get all selections for a plan.
 */
export async function getPlanSelections(planId: string, db: DbAdapter): Promise<FlexPlanSelection[]> {
  const rows = await db.query<SelectionRow>(
    `SELECT fps.*, fce.event_id
     FROM flex_plans.flex_plan_selections fps
     JOIN flex_plans.flex_catalog_events fce ON fce.id = fps.catalog_event_id
     WHERE fps.plan_id = $1
     ORDER BY fps.selected_at ASC`,
    [planId],
  );
  return rows.map(mapSelection);
}
