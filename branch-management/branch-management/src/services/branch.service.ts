import { BranchError } from '../lib/branch-errors';

// ---------------------------------------------------------------------------
// DB interface
// ---------------------------------------------------------------------------

export interface BranchDB {
  query: <T>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  execute: (sql: string, params?: unknown[]) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchInput {
  name: string;
  slug?: string;
  description?: string | null;
  addressStreet?: string | null;
  addressCity?: string | null;
  addressZip?: string | null;
  addressCountry?: string;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
  timezone?: string;
  isActive?: boolean;
  isMain?: boolean;
  metadata?: Record<string, unknown>;
}

export interface BranchFilters {
  isActive?: boolean;
  city?: string;
}

export interface Branch {
  id: string;
  promoterId: string;
  name: string;
  slug: string;
  description: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressZip: string | null;
  addressCountry: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  isActive: boolean;
  isMain: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  resourcesCount?: number;
  staffCount?: number;
  servicesCount?: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface BranchRow {
  id: string;
  promoter_id: string;
  name: string;
  slug: string;
  description: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  address_country: string;
  latitude: string | null;
  longitude: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  is_active: boolean;
  is_main: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  resources_count?: string | number;
  staff_count?: string | number;
  services_count?: string | number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    addressStreet: row.address_street,
    addressCity: row.address_city,
    addressZip: row.address_zip,
    addressCountry: row.address_country,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : null,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : null,
    phone: row.phone,
    email: row.email,
    timezone: row.timezone,
    isActive: row.is_active,
    isMain: row.is_main,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    resourcesCount: row.resources_count !== undefined ? Number(row.resources_count) : 0,
    staffCount: row.staff_count !== undefined ? Number(row.staff_count) : 0,
    servicesCount: row.services_count !== undefined ? Number(row.services_count) : 0,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createBranch(
  promoterId: string,
  input: BranchInput,
  db: BranchDB,
): Promise<Branch> {
  const slug = input.slug ?? slugify(input.name);

  // If setting as main branch, unset others first (execute — no query increment)
  if (input.isMain) {
    await db.execute(
      `UPDATE reservations.branches SET is_main = false WHERE promoter_id = $1 AND is_main = true`,
      [promoterId],
    );
  }

  // INSERT branch (execute — no query increment)
  await db.execute(
    `INSERT INTO reservations.branches
       (promoter_id, name, slug, description, address_street, address_city,
        address_zip, address_country, latitude, longitude, phone, email,
        timezone, is_active, is_main, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      promoterId,
      input.name,
      slug,
      input.description ?? null,
      input.addressStreet ?? null,
      input.addressCity ?? null,
      input.addressZip ?? null,
      input.addressCountry ?? 'CZ',
      input.latitude ?? null,
      input.longitude ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.timezone ?? 'Europe/Prague',
      input.isActive ?? true,
      input.isMain ?? false,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  // SELECT newly created branch (query — increments index)
  const { rows } = await db.query<BranchRow>(
    `SELECT b.*,
            0 AS resources_count,
            0 AS staff_count,
            0 AS services_count
     FROM reservations.branches b
     WHERE b.promoter_id = $1 AND b.slug = $2`,
    [promoterId, slug],
  );

  if (!rows[0]) {
    throw new BranchError('BRANCH_DUPLICATE');
  }

  return mapBranch(rows[0]);
}

export async function getBranch(
  branchId: string,
  db: BranchDB,
): Promise<Branch> {
  const { rows } = await db.query<BranchRow>(
    `SELECT b.*,
            (SELECT COUNT(*) FROM reservations.branch_service_availability bsa WHERE bsa.branch_id = b.id) AS resources_count,
            (SELECT COUNT(*) FROM reservations.branch_staff bs WHERE bs.branch_id = b.id AND bs.is_active = true) AS staff_count,
            (SELECT COUNT(*) FROM reservations.branch_service_availability bsa2 WHERE bsa2.branch_id = b.id AND bsa2.is_available = true) AS services_count
     FROM reservations.branches b
     WHERE b.id = $1`,
    [branchId],
  );

  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND');
  }

  return mapBranch(rows[0]);
}

export async function listBranches(
  promoterId: string,
  filters: BranchFilters,
  db: BranchDB,
): Promise<Branch[]> {
  const conditions: string[] = ['b.promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.isActive !== undefined) {
    conditions.push(`b.is_active = $${idx}`);
    params.push(filters.isActive);
    idx++;
  }
  if (filters.city !== undefined) {
    conditions.push(`b.address_city = $${idx}`);
    params.push(filters.city);
    idx++;
  }

  const { rows } = await db.query<BranchRow>(
    `SELECT b.*, 0 AS resources_count, 0 AS staff_count, 0 AS services_count
     FROM reservations.branches b
     WHERE ${conditions.join(' AND ')}
     ORDER BY b.is_main DESC, b.name ASC`,
    params,
  );

  return rows.map(mapBranch);
}

export async function updateBranch(
  branchId: string,
  promoterId: string,
  input: Partial<BranchInput>,
  db: BranchDB,
): Promise<Branch> {
  // If setting as main, unset others first
  if (input.isMain === true) {
    await db.execute(
      `UPDATE reservations.branches SET is_main = false WHERE promoter_id = $1 AND is_main = true AND id != $2`,
      [promoterId, branchId],
    );
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const fieldMap: Array<[keyof BranchInput, string]> = [
    ['name', 'name'],
    ['slug', 'slug'],
    ['description', 'description'],
    ['addressStreet', 'address_street'],
    ['addressCity', 'address_city'],
    ['addressZip', 'address_zip'],
    ['addressCountry', 'address_country'],
    ['latitude', 'latitude'],
    ['longitude', 'longitude'],
    ['phone', 'phone'],
    ['email', 'email'],
    ['timezone', 'timezone'],
    ['isActive', 'is_active'],
    ['isMain', 'is_main'],
    ['metadata', 'metadata'],
  ];

  for (const [camel, snake] of fieldMap) {
    if (input[camel] !== undefined) {
      sets.push(`${snake} = $${idx}`);
      params.push(camel === 'metadata' ? JSON.stringify(input[camel]) : input[camel]);
      idx++;
    }
  }

  if (sets.length === 0) {
    return getBranch(branchId, db);
  }

  params.push(branchId, promoterId);

  const { rows } = await db.query<BranchRow>(
    `UPDATE reservations.branches
     SET ${sets.join(', ')}
     WHERE id = $${idx} AND promoter_id = $${idx + 1} -- tenant-scoped
     RETURNING *, 0 AS resources_count, 0 AS staff_count, 0 AS services_count`,
    params,
  );

  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND');
  }

  return mapBranch(rows[0]);
}

export async function deactivateBranch(
  branchId: string,
  promoterId: string,
  db: BranchDB,
): Promise<void> {
  // tenant-scoped
  await db.execute(
    `UPDATE reservations.branches SET is_active = false WHERE id = $1 AND promoter_id = $2`,
    [branchId, promoterId],
  );
}

export async function getBranchBySlug(
  promoterId: string,
  slug: string,
  db: BranchDB,
): Promise<Branch> {
  const { rows } = await db.query<BranchRow>(
    `SELECT b.*, 0 AS resources_count, 0 AS staff_count, 0 AS services_count
     FROM reservations.branches b
     WHERE b.promoter_id = $1 AND b.slug = $2`,
    [promoterId, slug],
  );

  if (!rows[0]) {
    throw new BranchError('BRANCH_NOT_FOUND');
  }

  return mapBranch(rows[0]);
}

export async function isOpenAt(
  branchId: string,
  datetime: Date,
  db: BranchDB,
): Promise<boolean> {
  // Day of week: 0=Sunday, 1=Monday, ..., 6=Saturday
  const dayOfWeek = datetime.getDay();
  const timeStr = datetime.toTimeString().substring(0, 5); // HH:MM
  const dateStr = datetime.toISOString().substring(0, 10); // YYYY-MM-DD

  // Query 1: get hours for this day
  const { rows: hoursRows } = await db.query<{
    is_closed: boolean;
    open_time: string;
    close_time: string;
  }>(
    `SELECT is_closed, open_time, close_time
     FROM reservations.branch_hours
     WHERE branch_id = $1 AND day_of_week = $2`,
    [branchId, dayOfWeek],
  );

  if (!hoursRows[0] || hoursRows[0].is_closed) {
    return false;
  }

  const { open_time, close_time } = hoursRows[0];
  if (timeStr < open_time || timeStr >= close_time) {
    return false;
  }

  // Query 2: check for closures on this date
  const { rows: closureRows } = await db.query<{
    id: string;
    is_partial: boolean;
    partial_open_from: string | null;
    partial_open_until: string | null;
  }>(
    `SELECT id, is_partial, partial_open_from, partial_open_until
     FROM reservations.branch_closures
     WHERE branch_id = $1 AND closure_date = $2`,
    [branchId, dateStr],
  );

  if (!closureRows[0]) {
    return true;
  }

  const closure = closureRows[0];
  if (!closure.is_partial) {
    return false;
  }

  // Partial closure — check if within partial open window
  if (closure.partial_open_from && closure.partial_open_until) {
    return timeStr >= closure.partial_open_from && timeStr < closure.partial_open_until;
  }

  return false;
}
