// =============================================================================
// Ticket layout editor — Custom PDF templates (Feature #70)
//
// Vlastní grafická šablona PDF vstupenky per pořadatel nebo event:
// logo, barva, obrázek, vlastní text.
//
// SCHEMA: pdf_templates.* (migration 129)
// =============================================================================

export interface TicketTemplate {
  id: string;
  eventId: string;
  promoterId: string;
  name: string;
  logoUrl: string;                  // Brand logo
  backgroundColor?: string;         // Hex color
  backgroundImageUrl?: string;      // Obrázek pozadí
  textColor?: string;               // Barva textu
  customText?: string;              // Vlastní text (např. kontaktní info)
  qrPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
  isDefault: boolean;               // Výchozí šablona pro akci
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  eventId: string;
  name: string;
  logoUrl: string;
  backgroundColor?: string;
  backgroundImageUrl?: string;
  textColor?: string;
  customText?: string;
  qrPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface TemplateRow {
  id: string;
  event_id: string;
  promoter_id: string;
  name: string;
  logo_url: string;
  background_color: string | null;
  background_image_url: string | null;
  text_color: string | null;
  custom_text: string | null;
  qr_position: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

function mapTemplate(row: TemplateRow): TicketTemplate {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    name: row.name,
    logoUrl: row.logo_url,
    backgroundColor: row.background_color || undefined,
    backgroundImageUrl: row.background_image_url || undefined,
    textColor: row.text_color || undefined,
    customText: row.custom_text || undefined,
    qrPosition: row.qr_position as any,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Vytvoří novou šablonu vstupenky.
 */
export async function createTemplate(
  promoterId: string,
  input: CreateTemplateInput,
  db: DbAdapter,
): Promise<TicketTemplate> {
  if (!input.logoUrl) {
    throw new Error('VALIDATION_ERROR: logoUrl required');
  }

  const qrPosition = input.qrPosition ?? 'bottom-right';

  const rows = await db.query<TemplateRow>(
    `INSERT INTO pdf_templates.ticket_templates
       (event_id, promoter_id, name, logo_url, background_color, background_image_url,
        text_color, custom_text, qr_position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.eventId,
      promoterId,
      input.name,
      input.logoUrl,
      input.backgroundColor || null,
      input.backgroundImageUrl || null,
      input.textColor || null,
      input.customText || null,
      qrPosition,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: template creation failed');
  return mapTemplate(rows[0]);
}

/**
 * Vrátí výchozí šablonu pro event.
 */
export async function getDefaultTemplate(
  eventId: string,
  db: DbAdapter,
): Promise<TicketTemplate | null> {
  const rows = await db.query<TemplateRow>(
    `SELECT * FROM pdf_templates.ticket_templates
     WHERE event_id = $1 AND is_default = true
     LIMIT 1`,
    [eventId],
  );
  return rows[0] ? mapTemplate(rows[0]) : null;
}

/**
 * Vrátí všechny šablony pro akci (tenant-scoped).
 */
export async function listTemplatesForEvent(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<TicketTemplate[]> {
  const rows = await db.query<TemplateRow>(
    `SELECT * FROM pdf_templates.ticket_templates
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY is_default DESC, created_at DESC`,
    [eventId, promoterId],
  );
  return rows.map(mapTemplate);
}

/**
 * Nastaví šablonu jako výchozí (je_default=true, ostatní false).
 */
export async function setDefaultTemplate(
  templateId: string,
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<TicketTemplate> {
  await db.transaction(async (tx) => {
    // Smaž is_default u všech ostatních
    await tx.execute(
      `UPDATE pdf_templates.ticket_templates
       SET is_default = false
       WHERE event_id = $1 AND promoter_id = $2`,
      [eventId, promoterId],
    );

    // Nastav novou jako default
    await tx.execute(
      `UPDATE pdf_templates.ticket_templates
       SET is_default = true
       WHERE id = $1`,
      [templateId],
    );
  });

  const rows = await db.query<TemplateRow>(
    `SELECT * FROM pdf_templates.ticket_templates WHERE id = $1`,
    [templateId],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: template not found after update');
  return mapTemplate(rows[0]);
}

/**
 * Smaže šablonu (tenant-scoped).
 */
export async function deleteTemplate(
  templateId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `DELETE FROM pdf_templates.ticket_templates
     WHERE id = $1 AND promoter_id = $2`,
    [templateId, promoterId],
  );
}
