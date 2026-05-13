import { CatalogError } from '../lib/catalog-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface CatalogDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export interface ServiceCategory {
  id: string;
  promoterId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  serviceCount?: number;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  promoter_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  service_count?: string | number;
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

function mapCategory(row: CategoryRow): ServiceCategory {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    serviceCount: row.service_count !== undefined ? Number(row.service_count) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createCategory(
  promoterId: string,
  input: CategoryInput,
  db: CatalogDB,
): Promise<ServiceCategory> {
  const slug = input.slug ?? slugify(input.name);

  const { rows } = await db.query<CategoryRow>(
    `INSERT INTO reservations.service_categories
       (promoter_id, name, slug, description, icon, color, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      promoterId,
      input.name,
      slug,
      input.description ?? null,
      input.icon ?? null,
      input.color ?? '#6366f1',
      input.sortOrder ?? 0,
      input.isActive ?? true,
    ],
  );

  if (!rows[0]) {
    throw new CatalogError('CATEGORY_DUPLICATE');
  }

  return mapCategory(rows[0]);
}

export async function getCategory(
  categoryId: string,
  db: CatalogDB,
): Promise<ServiceCategory> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT sc.*,
            COUNT(s.id) AS service_count
     FROM reservations.service_categories sc
     LEFT JOIN reservations.services s
       ON s.category_id = sc.id AND s.is_active = true
     WHERE sc.id = $1
     GROUP BY sc.id`,
    [categoryId],
  );

  if (!rows[0]) {
    throw new CatalogError('CATEGORY_NOT_FOUND');
  }

  return mapCategory(rows[0]);
}

export async function listCategories(
  promoterId: string,
  db: CatalogDB,
): Promise<ServiceCategory[]> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT * FROM reservations.service_categories
     WHERE promoter_id = $1 AND is_active = true
     ORDER BY sort_order ASC, name ASC`,
    [promoterId],
  );

  return rows.map(mapCategory);
}

export async function updateCategory(
  categoryId: string,
  input: Partial<CategoryInput>,
  db: CatalogDB,
): Promise<ServiceCategory> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx}`);
    params.push(input.name);
    idx++;
  }
  if (input.slug !== undefined) {
    sets.push(`slug = $${idx}`);
    params.push(input.slug);
    idx++;
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx}`);
    params.push(input.description);
    idx++;
  }
  if (input.icon !== undefined) {
    sets.push(`icon = $${idx}`);
    params.push(input.icon);
    idx++;
  }
  if (input.color !== undefined) {
    sets.push(`color = $${idx}`);
    params.push(input.color);
    idx++;
  }
  if (input.sortOrder !== undefined) {
    sets.push(`sort_order = $${idx}`);
    params.push(input.sortOrder);
    idx++;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx++;
  }

  if (sets.length === 0) {
    return getCategory(categoryId, db);
  }

  params.push(categoryId);

  const { rows } = await db.query<CategoryRow>(
    `UPDATE reservations.service_categories
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CatalogError('CATEGORY_NOT_FOUND');
  }

  return mapCategory(rows[0]);
}

export async function deleteCategory(
  categoryId: string,
  db: CatalogDB,
): Promise<{ deleted: boolean; softDeleted: boolean }> {
  // Check if category has active services
  const { rows: serviceRows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*) AS cnt FROM reservations.services
     WHERE category_id = $1 AND is_active = true`,
    [categoryId],
  );

  const hasServices = Number(serviceRows[0]?.cnt ?? 0) > 0;

  if (hasServices) {
    // Soft delete: set is_active=false
    await db.execute(
      `UPDATE reservations.service_categories SET is_active = false WHERE id = $1`,
      [categoryId],
    );
    return { deleted: false, softDeleted: true };
  }

  // Hard delete
  await db.execute(
    `DELETE FROM reservations.service_categories WHERE id = $1`,
    [categoryId],
  );
  return { deleted: true, softDeleted: false };
}
