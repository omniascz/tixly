import { PackageError } from '../lib/package-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface PackageDB {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PackageType = 'bundle' | 'series' | 'membership' | 'gift';
export type ItemType = 'service' | 'credit' | 'access' | 'custom';

export interface PackageInput {
  name: string;
  slug?: string;
  branchId?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  packageType?: PackageType;
  priceHellers: number;
  originalPriceHellers?: number | null;
  validityDays?: number | null;
  maxActivations?: number;
  isActive?: boolean;
  isFeatured?: boolean;
  saleStart?: string | null;
  saleEnd?: string | null;
  imageUrl?: string | null;
  termsText?: string | null;
}

export interface PackageFilters {
  packageType?: PackageType;
  isActive?: boolean;
  isFeatured?: boolean;
  branchId?: string;
}

export interface ItemInput {
  serviceId?: string | null;
  itemType: ItemType;
  name: string;
  description?: string | null;
  quantity?: number;
  unit?: string;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
}

export interface Package {
  id: string;
  promoterId: string;
  branchId: string | null;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  packageType: PackageType;
  priceHellers: number;
  originalPriceHellers: number | null;
  validityDays: number | null;
  maxActivations: number;
  activationsSold: number;
  isActive: boolean;
  isFeatured: boolean;
  saleStart: string | null;
  saleEnd: string | null;
  imageUrl: string | null;
  termsText: string | null;
  createdAt: string;
  itemsCount?: number;
  purchasesCount?: number;
}

export interface PackageItem {
  id: string;
  packageId: string;
  serviceId: string | null;
  itemType: ItemType;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  sortOrder: number;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface PackageRow {
  id: string;
  promoter_id: string;
  branch_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  short_description: string | null;
  package_type: PackageType;
  price_hellers: number;
  original_price_hellers: number | null;
  validity_days: number | null;
  max_activations: number;
  activations_sold: number;
  is_active: boolean;
  is_featured: boolean;
  sale_start: string | null;
  sale_end: string | null;
  image_url: string | null;
  terms_text: string | null;
  created_at: string;
  items_count?: string | number;
  purchases_count?: string | number;
}

interface ItemRow {
  id: string;
  package_id: string;
  service_id: string | null;
  item_type: ItemType;
  name: string;
  description: string | null;
  quantity: number;
  unit: string;
  sort_order: number;
  metadata: Record<string, unknown>;
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

function mapPackage(row: PackageRow): Package {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    branchId: row.branch_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortDescription: row.short_description,
    packageType: row.package_type,
    priceHellers: row.price_hellers,
    originalPriceHellers: row.original_price_hellers,
    validityDays: row.validity_days,
    maxActivations: row.max_activations,
    activationsSold: row.activations_sold,
    isActive: row.is_active,
    isFeatured: row.is_featured,
    saleStart: row.sale_start,
    saleEnd: row.sale_end,
    imageUrl: row.image_url,
    termsText: row.terms_text,
    createdAt: row.created_at,
    itemsCount: row.items_count !== undefined ? Number(row.items_count) : undefined,
    purchasesCount: row.purchases_count !== undefined ? Number(row.purchases_count) : undefined,
  };
}

function mapItem(row: ItemRow): PackageItem {
  return {
    id: row.id,
    packageId: row.package_id,
    serviceId: row.service_id,
    itemType: row.item_type,
    name: row.name,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    sortOrder: row.sort_order,
    metadata: row.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createPackage(
  promoterId: string,
  input: PackageInput,
  db: PackageDB,
): Promise<Package> {
  const slug = input.slug ?? slugify(input.name);

  const { rows } = await db.query<PackageRow>(
    `INSERT INTO reservations.packages
       (promoter_id, branch_id, name, slug, description, short_description,
        package_type, price_hellers, original_price_hellers, validity_days,
        max_activations, is_active, is_featured, sale_start, sale_end,
        image_url, terms_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *, 0 AS items_count, 0 AS purchases_count`,
    [
      promoterId,
      input.branchId ?? null,
      input.name,
      slug,
      input.description ?? null,
      input.shortDescription ?? null,
      input.packageType ?? 'bundle',
      input.priceHellers,
      input.originalPriceHellers ?? null,
      input.validityDays ?? null,
      input.maxActivations ?? 1,
      input.isActive ?? true,
      input.isFeatured ?? false,
      input.saleStart ?? null,
      input.saleEnd ?? null,
      input.imageUrl ?? null,
      input.termsText ?? null,
    ],
  );

  if (!rows[0]) {
    throw new PackageError('PACKAGE_DUPLICATE');
  }

  return mapPackage(rows[0]);
}

export async function getPackage(
  packageId: string,
  db: PackageDB,
): Promise<Package> {
  const { rows } = await db.query<PackageRow>(
    `SELECT p.*,
            COUNT(DISTINCT pi.id) AS items_count,
            COUNT(DISTINCT pp.id) AS purchases_count
     FROM reservations.packages p
     LEFT JOIN reservations.package_items pi ON pi.package_id = p.id
     LEFT JOIN reservations.package_purchases pp ON pp.package_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [packageId],
  );

  if (!rows[0]) {
    throw new PackageError('PACKAGE_NOT_FOUND');
  }

  return mapPackage(rows[0]);
}

export async function listPackages(
  promoterId: string,
  filters: PackageFilters,
  db: PackageDB,
): Promise<Package[]> {
  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.packageType !== undefined) {
    conditions.push(`package_type = $${idx}`);
    params.push(filters.packageType);
    idx++;
  }
  if (filters.isActive !== undefined) {
    conditions.push(`is_active = $${idx}`);
    params.push(filters.isActive);
    idx++;
  }
  if (filters.isFeatured !== undefined) {
    conditions.push(`is_featured = $${idx}`);
    params.push(filters.isFeatured);
    idx++;
  }
  if (filters.branchId !== undefined) {
    conditions.push(`branch_id = $${idx}`);
    params.push(filters.branchId);
    idx++;
  }

  const { rows } = await db.query<PackageRow>(
    `SELECT *, 0 AS items_count, 0 AS purchases_count
     FROM reservations.packages
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );

  return rows.map(mapPackage);
}

export async function updatePackage(
  packageId: string,
  input: Partial<PackageInput>,
  db: PackageDB,
): Promise<Package> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const fieldMap: Array<[keyof PackageInput, string]> = [
    ['name', 'name'],
    ['slug', 'slug'],
    ['branchId', 'branch_id'],
    ['description', 'description'],
    ['shortDescription', 'short_description'],
    ['packageType', 'package_type'],
    ['priceHellers', 'price_hellers'],
    ['originalPriceHellers', 'original_price_hellers'],
    ['validityDays', 'validity_days'],
    ['maxActivations', 'max_activations'],
    ['isActive', 'is_active'],
    ['isFeatured', 'is_featured'],
    ['saleStart', 'sale_start'],
    ['saleEnd', 'sale_end'],
    ['imageUrl', 'image_url'],
    ['termsText', 'terms_text'],
  ];

  for (const [camel, snake] of fieldMap) {
    if (input[camel] !== undefined) {
      sets.push(`${snake} = $${idx}`);
      params.push(input[camel]);
      idx++;
    }
  }

  if (sets.length === 0) {
    return getPackage(packageId, db);
  }

  params.push(packageId);

  const { rows } = await db.query<PackageRow>(
    `UPDATE reservations.packages
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *, 0 AS items_count, 0 AS purchases_count`,
    params,
  );

  if (!rows[0]) {
    throw new PackageError('PACKAGE_NOT_FOUND');
  }

  return mapPackage(rows[0]);
}

export async function addItem(
  packageId: string,
  input: ItemInput,
  db: PackageDB,
): Promise<PackageItem> {
  const { rows } = await db.query<ItemRow>(
    `INSERT INTO reservations.package_items
       (package_id, service_id, item_type, name, description, quantity, unit, sort_order, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      packageId,
      input.serviceId ?? null,
      input.itemType,
      input.name,
      input.description ?? null,
      input.quantity ?? 1,
      input.unit ?? 'session',
      input.sortOrder ?? 0,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  if (!rows[0]) {
    throw new PackageError('ITEM_NOT_FOUND');
  }

  return mapItem(rows[0]);
}

export async function removeItem(
  itemId: string,
  db: PackageDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.package_items WHERE id = $1`,
    [itemId],
  );
}

export async function listItems(
  packageId: string,
  db: PackageDB,
): Promise<PackageItem[]> {
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM reservations.package_items
     WHERE package_id = $1
     ORDER BY sort_order ASC`,
    [packageId],
  );

  return rows.map(mapItem);
}
