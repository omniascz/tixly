// =============================================================================
// Badge Template Service
// =============================================================================

import { BadgeError, isPgUniqueViolation } from '../lib/badge-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface BadgeTemplateDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTemplateInput {
  name: string;
  widthMm?: number;
  heightMm?: number;
  backgroundColor?: string;
  accentColor?: string;
  logoUrl?: string;
  showPhoto?: boolean;
  showCompany?: boolean;
  showQr?: boolean;
  showRole?: boolean;
  fontSizeName?: number;
  fontSizeCompany?: number;
}

export interface UpdateTemplateInput {
  name?: string;
  widthMm?: number;
  heightMm?: number;
  backgroundColor?: string;
  accentColor?: string;
  logoUrl?: string;
  showPhoto?: boolean;
  showCompany?: boolean;
  showQr?: boolean;
  showRole?: boolean;
  fontSizeName?: number;
  fontSizeCompany?: number;
}

export interface BadgeTemplate {
  id: string;
  conferenceId: string;
  name: string;
  widthMm: number;
  heightMm: number;
  backgroundColor: string;
  accentColor: string;
  logoUrl: string | null;
  showPhoto: boolean;
  showCompany: boolean;
  showQr: boolean;
  showRole: boolean;
  fontSizeName: number;
  fontSizeCompany: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface TemplateRow {
  id: string;
  conference_id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  background_color: string;
  accent_color: string;
  logo_url: string | null;
  show_photo: boolean;
  show_company: boolean;
  show_qr: boolean;
  show_role: boolean;
  font_size_name: number;
  font_size_company: number;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapTemplate(row: TemplateRow): BadgeTemplate {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    name: row.name,
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    backgroundColor: row.background_color,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    showPhoto: row.show_photo,
    showCompany: row.show_company,
    showQr: row.show_qr,
    showRole: row.show_role,
    fontSizeName: row.font_size_name,
    fontSizeCompany: row.font_size_company,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// 1. createTemplate
// ---------------------------------------------------------------------------

export async function createTemplate(
  conferenceId: string,
  input: CreateTemplateInput,
  db: BadgeTemplateDB,
): Promise<BadgeTemplate> {
  try {
    const [row] = await db.query<TemplateRow>(
      `INSERT INTO conference.badge_templates
         (conference_id, name, width_mm, height_mm, background_color, accent_color,
          logo_url, show_photo, show_company, show_qr, show_role, font_size_name, font_size_company)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        conferenceId,
        input.name,
        input.widthMm ?? 85,
        input.heightMm ?? 54,
        input.backgroundColor ?? '#ffffff',
        input.accentColor ?? '#6366f1',
        input.logoUrl ?? null,
        input.showPhoto ?? true,
        input.showCompany ?? true,
        input.showQr ?? true,
        input.showRole ?? true,
        input.fontSizeName ?? 20,
        input.fontSizeCompany ?? 14,
      ],
    );
    return mapTemplate(row);
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new BadgeError('TEMPLATE_DUPLICATE');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. getTemplate
// ---------------------------------------------------------------------------

export async function getTemplate(
  templateId: string,
  db: BadgeTemplateDB,
): Promise<BadgeTemplate> {
  const [row] = await db.query<TemplateRow>(
    `SELECT * FROM conference.badge_templates WHERE id = $1`,
    [templateId],
  );
  if (!row) throw new BadgeError('TEMPLATE_NOT_FOUND');
  return mapTemplate(row);
}

// ---------------------------------------------------------------------------
// 3. listTemplates
// ---------------------------------------------------------------------------

export async function listTemplates(
  conferenceId: string,
  db: BadgeTemplateDB,
): Promise<BadgeTemplate[]> {
  const rows = await db.query<TemplateRow>(
    `SELECT * FROM conference.badge_templates WHERE conference_id = $1 ORDER BY created_at ASC`,
    [conferenceId],
  );
  return rows.map(mapTemplate);
}

// ---------------------------------------------------------------------------
// 4. updateTemplate
// ---------------------------------------------------------------------------

export async function updateTemplate(
  templateId: string,
  input: UpdateTemplateInput,
  db: BadgeTemplateDB,
): Promise<BadgeTemplate> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<keyof UpdateTemplateInput, string> = {
    name: 'name',
    widthMm: 'width_mm',
    heightMm: 'height_mm',
    backgroundColor: 'background_color',
    accentColor: 'accent_color',
    logoUrl: 'logo_url',
    showPhoto: 'show_photo',
    showCompany: 'show_company',
    showQr: 'show_qr',
    showRole: 'show_role',
    fontSizeName: 'font_size_name',
    fontSizeCompany: 'font_size_company',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    const val = input[key as keyof UpdateTemplateInput];
    if (val !== undefined) {
      sets.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  if (sets.length === 0) {
    return getTemplate(templateId, db);
  }

  values.push(templateId);
  const [row] = await db.query<TemplateRow>(
    `UPDATE conference.badge_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  if (!row) throw new BadgeError('TEMPLATE_NOT_FOUND');
  return mapTemplate(row);
}
