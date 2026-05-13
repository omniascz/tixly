import { SlotError } from '../lib/slot-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface SlotDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResourceInput {
  name: string;
  resourceType: string;
  description?: string;
  capacity?: number;
  isActive?: boolean;
  branchId?: string;
  metadata?: Record<string, unknown>;
}

export interface ResourceUpdateInput {
  name?: string;
  resourceType?: string;
  description?: string;
  capacity?: number;
  isActive?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ResourceFilters {
  branchId?: string;
  resourceType?: string;
  isActive?: boolean;
}

export interface Resource {
  id: string;
  promoterId: string;
  branchId: string | null;
  name: string;
  resourceType: string;
  description: string | null;
  capacity: number;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ResourceRow {
  id: string;
  promoter_id: string;
  branch_id: string | null;
  name: string;
  resource_type: string;
  description: string | null;
  capacity: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    branchId: row.branch_id,
    name: row.name,
    resourceType: row.resource_type,
    description: row.description,
    capacity: row.capacity,
    isActive: row.is_active,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function createResource(
  promoterId: string,
  input: ResourceInput,
  db: SlotDB,
): Promise<Resource> {
  const { rows } = await db.query<ResourceRow>(
    `INSERT INTO reservations.resources
       (promoter_id, branch_id, name, resource_type, description, capacity, is_active, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      promoterId,
      input.branchId ?? null,
      input.name,
      input.resourceType,
      input.description ?? null,
      input.capacity ?? 1,
      input.isActive ?? true,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  if (!rows[0]) {
    throw new SlotError('RESOURCE_DUPLICATE');
  }

  return mapResource(rows[0]);
}

export async function getResource(
  resourceId: string,
  db: SlotDB,
): Promise<Resource> {
  const { rows } = await db.query<ResourceRow>(
    `SELECT * FROM reservations.resources WHERE id = $1`,
    [resourceId],
  );

  if (!rows[0]) {
    throw new SlotError('RESOURCE_NOT_FOUND');
  }

  return mapResource(rows[0]);
}

export async function listResources(
  promoterId: string,
  filters: ResourceFilters,
  db: SlotDB,
): Promise<Resource[]> {
  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.branchId !== undefined) {
    conditions.push(`branch_id = $${idx}`);
    params.push(filters.branchId);
    idx++;
  }
  if (filters.resourceType !== undefined) {
    conditions.push(`resource_type = $${idx}`);
    params.push(filters.resourceType);
    idx++;
  }
  if (filters.isActive !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.isActive);
    idx++;
  }

  const { rows } = await db.query<ResourceRow>(
    `SELECT * FROM reservations.resources WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC`,
    params,
  );

  return rows.map(mapResource);
}

export async function updateResource(
  resourceId: string,
  input: ResourceUpdateInput,
  db: SlotDB,
): Promise<Resource> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx++;
  }
  if (input.resourceType !== undefined) {
    sets.push(`resource_type = $${idx}`);
    params.push(input.resourceType);
    idx++;
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx}`);
    params.push(input.description);
    idx++;
  }
  if (input.capacity !== undefined) {
    sets.push(`capacity = $${idx}`);
    params.push(input.capacity);
    idx++;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx++;
  }
  if (input.metadata !== undefined) {
    sets.push(`metadata = $${idx}`);
    params.push(JSON.stringify(input.metadata));
    idx++;
  }

  if (sets.length === 0) {
    return getResource(resourceId, db);
  }

  params.push(resourceId);

  const { rows } = await db.query<ResourceRow>(
    `UPDATE reservations.resources
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new SlotError('RESOURCE_NOT_FOUND');
  }

  return mapResource(rows[0]);
}

export async function deactivateResource(
  resourceId: string,
  db: SlotDB,
): Promise<Resource> {
  const { rows } = await db.query<ResourceRow>(
    `UPDATE reservations.resources SET is_active = false WHERE id = $1 RETURNING *`,
    [resourceId],
  );

  if (!rows[0]) {
    throw new SlotError('RESOURCE_NOT_FOUND');
  }

  return mapResource(rows[0]);
}
