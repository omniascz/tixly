// =============================================================================
// Booth Service
// =============================================================================

import { ExhibitorError, isPgUniqueViolation } from '../lib/exhibitor-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface BoothDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BoothStatus = 'available' | 'reserved' | 'confirmed' | 'blocked';

export interface CreateBoothInput {
  floorMapId: string;
  categoryId?: string;
  boothNumber: string;
  xPx?: number;
  yPx?: number;
  widthPx?: number;
  heightPx?: number;
  status?: BoothStatus;
  priceHellers?: number;
  notes?: string;
}

export interface UpdateBoothInput {
  categoryId?: string | null;
  boothNumber?: string;
  xPx?: number;
  yPx?: number;
  widthPx?: number;
  heightPx?: number;
  status?: BoothStatus;
  priceHellers?: number;
  notes?: string | null;
}

export interface ListBoothFilters {
  status?: BoothStatus;
  categoryId?: string;
  floorMapId?: string;
}

export interface AssignBoothInput {
  setupStart?: string;
  teardownEnd?: string;
  notes?: string;
}

export interface CreateCategoryInput {
  name: string;
  color?: string;
  description?: string;
  sortOrder?: number;
}

export interface Booth {
  id: string;
  conferenceId: string;
  floorMapId: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  boothNumber: string;
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  status: BoothStatus;
  priceHellers: number;
  notes: string | null;
  assignment: BoothAssignment | null;
  createdAt: string;
}

export interface BoothAssignment {
  id?: string;
  boothId: string;
  exhibitorId: string;
  exhibitorName: string;
  assignedAt: string;
  confirmedAt: string | null;
  setupStart: string | null;
  teardownEnd: string | null;
  notes: string | null;
}

export interface BoothCategory {
  id: string;
  conferenceId: string;
  name: string;
  color: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface BoothRow {
  id: string;
  conference_id: string;
  floor_map_id: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  booth_number: string;
  x_px: number;
  y_px: number;
  width_px: number;
  height_px: number;
  status: string;
  price_hellers: number;
  notes: string | null;
  created_at: string;
  // assignment fields
  exhibitor_id: string | null;
  company_name: string | null;
  assigned_at: string | null;
  confirmed_at: string | null;
  setup_start: string | null;
  teardown_end: string | null;
  assignment_notes: string | null;
}

interface CategoryRow {
  id: string;
  conference_id: string;
  name: string;
  color: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapBooth(row: BoothRow): Booth {
  const assignment: BoothAssignment | null = row.exhibitor_id
    ? {
        boothId: row.id,
        exhibitorId: row.exhibitor_id,
        exhibitorName: row.company_name ?? '',
        assignedAt: row.assigned_at ?? '',
        confirmedAt: row.confirmed_at,
        setupStart: row.setup_start,
        teardownEnd: row.teardown_end,
        notes: row.assignment_notes,
      }
    : null;

  return {
    id: row.id,
    conferenceId: row.conference_id,
    floorMapId: row.floor_map_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    boothNumber: row.booth_number,
    xPx: row.x_px,
    yPx: row.y_px,
    widthPx: row.width_px,
    heightPx: row.height_px,
    status: row.status as BoothStatus,
    priceHellers: row.price_hellers,
    notes: row.notes,
    assignment,
    createdAt: row.created_at,
  };
}

function mapCategory(row: CategoryRow): BoothCategory {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    name: row.name,
    color: row.color,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Shared SELECT for booth with joins
// ---------------------------------------------------------------------------

const BOOTH_SELECT = `
  SELECT b.*,
         bc.name  AS category_name,
         bc.color AS category_color,
         ba.exhibitor_id,
         e.company_name,
         ba.assigned_at,
         ba.confirmed_at,
         ba.setup_start,
         ba.teardown_end,
         ba.notes AS assignment_notes
  FROM conference.booths b
  LEFT JOIN conference.booth_categories bc ON bc.id = b.category_id
  LEFT JOIN conference.booth_assignments ba ON ba.booth_id = b.id
  LEFT JOIN conference.exhibitors e ON e.id = ba.exhibitor_id
`;

// ---------------------------------------------------------------------------
// 1. createBooth
// ---------------------------------------------------------------------------

export async function createBooth(
  conferenceId: string,
  input: CreateBoothInput,
  db: BoothDB,
): Promise<Booth> {
  try {
    const [row] = await db.query<BoothRow>(
      `${BOOTH_SELECT}
       WHERE b.id = (
         INSERT INTO conference.booths
           (conference_id, floor_map_id, category_id, booth_number, x_px, y_px,
            width_px, height_px, status, price_hellers, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id
       )`,
      [
        conferenceId,
        input.floorMapId,
        input.categoryId ?? null,
        input.boothNumber,
        input.xPx ?? 0,
        input.yPx ?? 0,
        input.widthPx ?? 100,
        input.heightPx ?? 100,
        input.status ?? 'available',
        input.priceHellers ?? 0,
        input.notes ?? null,
      ],
    );
    return mapBooth(row);
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new ExhibitorError('BOOTH_NOT_FOUND');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. getBooth
// ---------------------------------------------------------------------------

export async function getBooth(
  boothId: string,
  db: BoothDB,
): Promise<Booth> {
  const [row] = await db.query<BoothRow>(
    `${BOOTH_SELECT} WHERE b.id = $1`,
    [boothId],
  );
  if (!row) throw new ExhibitorError('BOOTH_NOT_FOUND');
  return mapBooth(row);
}

// ---------------------------------------------------------------------------
// 3. updateBooth
// ---------------------------------------------------------------------------

export async function updateBooth(
  boothId: string,
  input: UpdateBoothInput,
  db: BoothDB,
): Promise<Booth> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Partial<Record<keyof UpdateBoothInput, string>> = {
    categoryId: 'category_id',
    boothNumber: 'booth_number',
    xPx: 'x_px',
    yPx: 'y_px',
    widthPx: 'width_px',
    heightPx: 'height_px',
    status: 'status',
    priceHellers: 'price_hellers',
    notes: 'notes',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    const val = input[key as keyof UpdateBoothInput];
    if (val !== undefined) {
      sets.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  if (sets.length === 0) return getBooth(boothId, db);

  values.push(boothId);
  const [row] = await db.query<BoothRow>(
    `${BOOTH_SELECT}
     WHERE b.id = (
       UPDATE conference.booths SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id
     )`,
    values,
  );
  if (!row) throw new ExhibitorError('BOOTH_NOT_FOUND');
  return mapBooth(row);
}

// ---------------------------------------------------------------------------
// 4. listBooths
// ---------------------------------------------------------------------------

export async function listBooths(
  conferenceId: string,
  filters: ListBoothFilters,
  db: BoothDB,
): Promise<Booth[]> {
  const conditions: string[] = ['b.conference_id = $1'];
  const values: unknown[] = [conferenceId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`b.status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.categoryId) {
    conditions.push(`b.category_id = $${idx++}`);
    values.push(filters.categoryId);
  }
  if (filters.floorMapId) {
    conditions.push(`b.floor_map_id = $${idx++}`);
    values.push(filters.floorMapId);
  }

  const rows = await db.query<BoothRow>(
    `${BOOTH_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY b.booth_number ASC`,
    values,
  );
  return rows.map(mapBooth);
}

// ---------------------------------------------------------------------------
// 5. assignBooth
// ---------------------------------------------------------------------------

export async function assignBooth(
  boothId: string,
  exhibitorId: string,
  input: AssignBoothInput,
  db: BoothDB,
): Promise<Booth> {
  // Check booth status
  const [boothCheck] = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM conference.booths WHERE id = $1`,
    [boothId],
  );
  if (!boothCheck) throw new ExhibitorError('BOOTH_NOT_FOUND');
  if (boothCheck.status !== 'available' && boothCheck.status !== 'reserved') {
    throw new ExhibitorError('BOOTH_NOT_AVAILABLE');
  }

  try {
    await db.execute(
      `INSERT INTO conference.booth_assignments
         (booth_id, exhibitor_id, setup_start, teardown_end, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        boothId,
        exhibitorId,
        input.setupStart ?? null,
        input.teardownEnd ?? null,
        input.notes ?? null,
      ],
    );
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new ExhibitorError('BOOTH_ALREADY_ASSIGNED');
    throw err;
  }

  await db.execute(
    `UPDATE conference.booths SET status = 'confirmed' WHERE id = $1`,
    [boothId],
  );

  return getBooth(boothId, db);
}

// ---------------------------------------------------------------------------
// 6. unassignBooth
// ---------------------------------------------------------------------------

export async function unassignBooth(
  boothId: string,
  db: BoothDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM conference.booth_assignments WHERE booth_id = $1`,
    [boothId],
  );
  await db.execute(
    `UPDATE conference.booths SET status = 'available' WHERE id = $1`,
    [boothId],
  );
}

// ---------------------------------------------------------------------------
// 7. createCategory
// ---------------------------------------------------------------------------

export async function createCategory(
  conferenceId: string,
  input: CreateCategoryInput,
  db: BoothDB,
): Promise<BoothCategory> {
  const [row] = await db.query<CategoryRow>(
    `INSERT INTO conference.booth_categories
       (conference_id, name, color, description, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      conferenceId,
      input.name,
      input.color ?? '#808080',
      input.description ?? null,
      input.sortOrder ?? 0,
    ],
  );
  return mapCategory(row);
}
