// =============================================================================
// Floor Map Service
// =============================================================================

import { ExhibitorError, isPgUniqueViolation } from '../lib/exhibitor-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface FloorMapDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateFloorMapInput {
  name: string;
  svgContent?: string;
  widthPx?: number;
  heightPx?: number;
}

export interface UpdateFloorMapInput {
  name?: string;
  svgContent?: string;
  widthPx?: number;
  heightPx?: number;
}

export interface FloorMap {
  id: string;
  conferenceId: string;
  name: string;
  svgContent: string | null;
  widthPx: number;
  heightPx: number;
  boothCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoothOnMap {
  id: string;
  boothNumber: string;
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  status: string;
  pricehellers: number;
  categoryId: string | null;
  exhibitorId: string | null;
  exhibitorName: string | null;
}

export interface FloorMapWithBooths extends FloorMap {
  booths: BoothOnMap[];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface FloorMapRow {
  id: string;
  conference_id: string;
  name: string;
  svg_content: string | null;
  width_px: number;
  height_px: number;
  booth_count?: string | number;
  created_at: string;
  updated_at: string;
}

interface BoothRow {
  id: string;
  booth_number: string;
  x_px: number;
  y_px: number;
  width_px: number;
  height_px: number;
  status: string;
  price_hellers: number;
  category_id: string | null;
  exhibitor_id: string | null;
  company_name: string | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapFloorMap(row: FloorMapRow): FloorMap {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    name: row.name,
    svgContent: row.svg_content,
    widthPx: row.width_px,
    heightPx: row.height_px,
    boothCount: typeof row.booth_count === 'string'
      ? parseInt(row.booth_count, 10)
      : (row.booth_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBooth(row: BoothRow): BoothOnMap {
  return {
    id: row.id,
    boothNumber: row.booth_number,
    xPx: row.x_px,
    yPx: row.y_px,
    widthPx: row.width_px,
    heightPx: row.height_px,
    status: row.status,
    pricehellers: row.price_hellers,
    categoryId: row.category_id,
    exhibitorId: row.exhibitor_id,
    exhibitorName: row.company_name,
  };
}

// ---------------------------------------------------------------------------
// 1. createFloorMap
// ---------------------------------------------------------------------------

export async function createFloorMap(
  conferenceId: string,
  input: CreateFloorMapInput,
  db: FloorMapDB,
): Promise<FloorMap> {
  try {
    const [row] = await db.query<FloorMapRow>(
      `INSERT INTO conference.floor_maps
         (conference_id, name, svg_content, width_px, height_px)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *, 0 AS booth_count`,
      [
        conferenceId,
        input.name,
        input.svgContent ?? null,
        input.widthPx ?? 1000,
        input.heightPx ?? 800,
      ],
    );
    return mapFloorMap(row);
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new ExhibitorError('FLOOR_MAP_DUPLICATE');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. getFloorMap
// ---------------------------------------------------------------------------

export async function getFloorMap(
  floorMapId: string,
  db: FloorMapDB,
): Promise<FloorMap> {
  const [row] = await db.query<FloorMapRow>(
    `SELECT fm.*, COUNT(b.id) AS booth_count
     FROM conference.floor_maps fm
     LEFT JOIN conference.booths b ON b.floor_map_id = fm.id
     WHERE fm.id = $1
     GROUP BY fm.id`,
    [floorMapId],
  );
  if (!row) throw new ExhibitorError('FLOOR_MAP_NOT_FOUND');
  return mapFloorMap(row);
}

// ---------------------------------------------------------------------------
// 3. updateFloorMap
// ---------------------------------------------------------------------------

export async function updateFloorMap(
  floorMapId: string,
  input: UpdateFloorMapInput,
  db: FloorMapDB,
): Promise<FloorMap> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) { sets.push(`name = $${idx++}`); values.push(input.name); }
  if (input.svgContent !== undefined) { sets.push(`svg_content = $${idx++}`); values.push(input.svgContent); }
  if (input.widthPx !== undefined) { sets.push(`width_px = $${idx++}`); values.push(input.widthPx); }
  if (input.heightPx !== undefined) { sets.push(`height_px = $${idx++}`); values.push(input.heightPx); }

  sets.push(`updated_at = NOW()`);
  values.push(floorMapId);

  const [row] = await db.query<FloorMapRow>(
    `UPDATE conference.floor_maps SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *, 0 AS booth_count`,
    values,
  );
  if (!row) throw new ExhibitorError('FLOOR_MAP_NOT_FOUND');
  return mapFloorMap(row);
}

// ---------------------------------------------------------------------------
// 4. listFloorMaps
// ---------------------------------------------------------------------------

export async function listFloorMaps(
  conferenceId: string,
  db: FloorMapDB,
): Promise<FloorMap[]> {
  const rows = await db.query<FloorMapRow>(
    `SELECT fm.*, COUNT(b.id) AS booth_count
     FROM conference.floor_maps fm
     LEFT JOIN conference.booths b ON b.floor_map_id = fm.id
     WHERE fm.conference_id = $1
     GROUP BY fm.id
     ORDER BY fm.created_at ASC`,
    [conferenceId],
  );
  return rows.map(mapFloorMap);
}

// ---------------------------------------------------------------------------
// 5. getFloorMapWithBooths
// ---------------------------------------------------------------------------

export async function getFloorMapWithBooths(
  floorMapId: string,
  db: FloorMapDB,
): Promise<FloorMapWithBooths> {
  const [mapRow] = await db.query<FloorMapRow>(
    `SELECT fm.*, COUNT(b.id) AS booth_count
     FROM conference.floor_maps fm
     LEFT JOIN conference.booths b ON b.floor_map_id = fm.id
     WHERE fm.id = $1
     GROUP BY fm.id`,
    [floorMapId],
  );
  if (!mapRow) throw new ExhibitorError('FLOOR_MAP_NOT_FOUND');

  const boothRows = await db.query<BoothRow>(
    `SELECT b.*,
            ba.exhibitor_id,
            e.company_name
     FROM conference.booths b
     LEFT JOIN conference.booth_assignments ba ON ba.booth_id = b.id
     LEFT JOIN conference.exhibitors e ON e.id = ba.exhibitor_id
     WHERE b.floor_map_id = $1
     ORDER BY b.booth_number ASC`,
    [floorMapId],
  );

  return {
    ...mapFloorMap(mapRow),
    booths: boothRows.map(mapBooth),
  };
}
