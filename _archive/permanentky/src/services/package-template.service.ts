// =============================================================================
// Package Template Service — správa šablon permanentek
// =============================================================================

import type { ServiceDeps } from '../lib/service-container.js';
import { PermanentkyError } from '../lib/permanentky-errors.js';
import type { PackageTemplate, PackageType } from '../types/permanentky.js';

interface TemplateRow {
  id: string;
  promoter_id: string;
  name: string;
  type: string;
  total_credits: number;
  validity_days: number;
  price_halire: number;
  description: string | null;
  is_active: boolean;
  created_at: Date;
}

function mapTemplate(row: TemplateRow): PackageTemplate {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    type: row.type as PackageType,
    totalCredits: row.total_credits,
    validityDays: row.validity_days,
    priceHalire: row.price_halire,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export interface CreateTemplateInput {
  name: string;
  type: PackageType;
  totalCredits: number;
  validityDays: number;
  priceHalire: number;
  description?: string;
}

export async function createTemplate(
  promoterId: string,
  input: CreateTemplateInput,
  deps: ServiceDeps,
): Promise<PackageTemplate> {
  if (input.validityDays <= 0) {
    throw new PermanentkyError('INVALID_VALIDITY_DAYS');
  }
  if (input.totalCredits <= 0) {
    throw new PermanentkyError('INVALID_VALIDITY_DAYS', 'totalCredits must be > 0');
  }

  const { rows } = await deps.db.query<TemplateRow>(
    `INSERT INTO permanentky.templates
       (promoter_id, name, type, total_credits, validity_days, price_halire, description, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
     RETURNING *`,
    [
      promoterId,
      input.name,
      input.type,
      input.totalCredits,
      input.validityDays,
      input.priceHalire,
      input.description ?? null,
    ],
  );
  return mapTemplate(rows[0]);
}

export async function listTemplates(
  promoterId: string,
  deps: ServiceDeps,
): Promise<PackageTemplate[]> {
  const { rows } = await deps.db.query<TemplateRow>(
    `SELECT * FROM permanentky.templates
      WHERE promoter_id = $1
      ORDER BY created_at DESC`,
    [promoterId],
  );
  return rows.map(mapTemplate);
}

export async function updateTemplate(
  templateId: string,
  promoterId: string,
  input: Partial<PackageTemplate>,
  deps: ServiceDeps,
): Promise<PackageTemplate> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const push = (col: string, val: unknown) => {
    fields.push(`${col} = $${idx++}`);
    values.push(val);
  };

  if (input.name !== undefined) push('name', input.name);
  if (input.type !== undefined) push('type', input.type);
  if (input.totalCredits !== undefined) push('total_credits', input.totalCredits);
  if (input.validityDays !== undefined) {
    if (input.validityDays <= 0) throw new PermanentkyError('INVALID_VALIDITY_DAYS');
    push('validity_days', input.validityDays);
  }
  if (input.priceHalire !== undefined) push('price_halire', input.priceHalire);
  if (input.description !== undefined) push('description', input.description);
  if (input.isActive !== undefined) push('is_active', input.isActive);

  if (fields.length === 0) {
    const existing = await deps.db.query<TemplateRow>(
      `SELECT * FROM permanentky.templates WHERE id = $1 AND promoter_id = $2`,
      [templateId, promoterId],
    );
    if (existing.rows.length === 0) throw new PermanentkyError('TEMPLATE_NOT_FOUND');
    return mapTemplate(existing.rows[0]);
  }

  values.push(templateId, promoterId);
  const { rows } = await deps.db.query<TemplateRow>(
    `UPDATE permanentky.templates
        SET ${fields.join(', ')}
      WHERE id = $${idx++} AND promoter_id = $${idx++}
      RETURNING *`,
    values,
  );
  if (rows.length === 0) throw new PermanentkyError('TEMPLATE_NOT_FOUND');
  return mapTemplate(rows[0]);
}

export async function deactivateTemplate(
  templateId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const { rowCount } = await deps.db.query(
    `UPDATE permanentky.templates
        SET is_active = FALSE
      WHERE id = $1 AND promoter_id = $2`,
    [templateId, promoterId],
  );
  if (!rowCount) throw new PermanentkyError('TEMPLATE_NOT_FOUND');
}

/**
 * Seed PulseUp defaults:
 * - měsíční: 4 lekce, 30 dní, 3000 Kč (300000 halíře)
 * - 10lekci: 10 lekcí, 180 dní, 6900 Kč (690000 halíře)
 */
export async function seedDefaultTemplates(
  promoterId: string,
  deps: ServiceDeps,
): Promise<{ created: PackageTemplate[] }> {
  const mesicni = await createTemplate(
    promoterId,
    {
      name: 'Měsíční permanentka',
      type: 'mesicni',
      totalCredits: 4,
      validityDays: 30,
      priceHalire: 300000,
      description: '4 lekce platné 30 dní',
    },
    deps,
  );
  const tenlekci = await createTemplate(
    promoterId,
    {
      name: 'Permanentka 10 lekcí',
      type: '10lekci',
      totalCredits: 10,
      validityDays: 180,
      priceHalire: 690000,
      description: '10 lekcí platných 6 měsíců',
    },
    deps,
  );
  return { created: [mesicni, tenlekci] };
}
