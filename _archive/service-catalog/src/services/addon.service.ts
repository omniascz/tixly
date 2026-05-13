import { CatalogError } from '../lib/catalog-errors';
import type { CatalogDB } from './category.service';
import type { ServiceAddon } from './service.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddonInput {
  name: string;
  description?: string | null;
  priceHellers?: number;
  maxQuantity?: number;
  isRequired?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface AddonRow {
  id: string;
  service_id: string;
  name: string;
  description: string | null;
  price_hellers: number;
  max_quantity: number;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapAddon(row: AddonRow): ServiceAddon {
  return {
    id: row.id,
    serviceId: row.service_id,
    name: row.name,
    description: row.description,
    priceHellers: row.price_hellers,
    maxQuantity: row.max_quantity,
    isRequired: row.is_required,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createAddon(
  serviceId: string,
  input: AddonInput,
  db: CatalogDB,
): Promise<ServiceAddon> {
  const { rows } = await db.query<AddonRow>(
    `INSERT INTO reservations.service_addons
       (service_id, name, description, price_hellers, max_quantity, is_required, is_active, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      serviceId,
      input.name,
      input.description ?? null,
      input.priceHellers ?? 0,
      input.maxQuantity ?? 1,
      input.isRequired ?? false,
      input.isActive ?? true,
      input.sortOrder ?? 0,
    ],
  );

  if (!rows[0]) {
    throw new CatalogError('ADDON_DUPLICATE');
  }

  return mapAddon(rows[0]);
}

export async function getAddon(
  addonId: string,
  db: CatalogDB,
): Promise<ServiceAddon> {
  const { rows } = await db.query<AddonRow>(
    `SELECT * FROM reservations.service_addons WHERE id = $1`,
    [addonId],
  );

  if (!rows[0]) {
    throw new CatalogError('ADDON_NOT_FOUND');
  }

  return mapAddon(rows[0]);
}

export async function listAddons(
  serviceId: string,
  db: CatalogDB,
): Promise<ServiceAddon[]> {
  const { rows } = await db.query<AddonRow>(
    `SELECT * FROM reservations.service_addons
     WHERE service_id = $1 AND is_active = true
     ORDER BY sort_order ASC, name ASC`,
    [serviceId],
  );

  return rows.map(mapAddon);
}

export async function updateAddon(
  addonId: string,
  input: Partial<AddonInput>,
  db: CatalogDB,
): Promise<ServiceAddon> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx++;
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx}`);
    params.push(input.description);
    idx++;
  }
  if (input.priceHellers !== undefined) {
    sets.push(`price_hellers = $${idx}`);
    params.push(input.priceHellers);
    idx++;
  }
  if (input.maxQuantity !== undefined) {
    sets.push(`max_quantity = $${idx}`);
    params.push(input.maxQuantity);
    idx++;
  }
  if (input.isRequired !== undefined) {
    sets.push(`is_required = $${idx}`);
    params.push(input.isRequired);
    idx++;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx++;
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`);
    params.push(input.sortOrder);
    idx++;
  }

  if (sets.length === 0) {
    return getAddon(addonId, db);
  }

  params.push(addonId);

  const { rows } = await db.query<AddonRow>(
    `UPDATE reservations.service_addons
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CatalogError('ADDON_NOT_FOUND');
  }

  return mapAddon(rows[0]);
}

export async function deleteAddon(
  addonId: string,
  db: CatalogDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.service_addons WHERE id = $1`,
    [addonId],
  );
}
