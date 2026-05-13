// =============================================================================
// Dynamic Creative — Automatic ad template rendering (Feature #59)
//
// Jeden reklamní template automaticky generuje kreativy pro všechny akce.
// Datum, čas, cena se mění automaticky.
// Navázáno na #52 (Promoted Ads).
//
// SCHEMA: ads.* (migration 118)
// =============================================================================

export interface DynamicCreativeTemplate {
  id: string;
  promoterId: string;
  title: string;
  templateText: string;      // Placeholders: {{eventTitle}}, {{eventDate}}, {{eventTime}}, {{price}}, {{venueName}}
  imageUrl: string;          // Background image
  ctaText: string;           // "Get Tickets"
  status: 'draft' | 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface RenderCreativeInput {
  eventTitle: string;
  eventDate: string;         // YYYY-MM-DD
  eventTime: string;         // HH:mm
  priceHalire: number;
  venueName: string;
}

export interface RenderedCreative {
  id: string;
  templateId: string;
  eventId: string;
  renderedText: string;
  imageUrl: string;
  ctaText: string;
  previewUrl: string;        // URL obrázku s vyrenderovaným textem
  createdAt: string;
}

export interface CreateTemplateInput {
  title: string;
  templateText: string;
  imageUrl: string;
  ctaText: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface TemplateRow {
  id: string;
  promoter_id: string;
  title: string;
  template_text: string;
  image_url: string;
  cta_text: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapTemplate(row: TemplateRow): DynamicCreativeTemplate {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    title: row.title,
    templateText: row.template_text,
    imageUrl: row.image_url,
    ctaText: row.cta_text,
    status: row.status as 'draft' | 'active' | 'archived',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function renderPlaceholders(template: string, input: RenderCreativeInput): string {
  const priceString = (input.priceHalire / 100).toFixed(2);
  return template
    .replace(/\{\{eventTitle\}\}/g, input.eventTitle)
    .replace(/\{\{eventDate\}\}/g, input.eventDate)
    .replace(/\{\{eventTime\}\}/g, input.eventTime)
    .replace(/\{\{price\}\}/g, priceString)
    .replace(/\{\{venueName\}\}/g, input.venueName);
}

/**
 * Vytvoří nový dynamic creative template (draft status).
 */
export async function createTemplate(
  promoterId: string,
  input: CreateTemplateInput,
  db: DbAdapter,
): Promise<DynamicCreativeTemplate> {
  if (!input.templateText.includes('{{')) {
    console.warn('Template has no placeholders — will render as static text');
  }
  const rows = await db.query<TemplateRow>(
    `INSERT INTO ads.dynamic_creative_templates
       (promoter_id, title, template_text, image_url, cta_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [promoterId, input.title, input.templateText, input.imageUrl, input.ctaText],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: template creation failed');
  return mapTemplate(rows[0]);
}

/**
 * Vrátí aktivní templates pro promotéra.
 */
export async function listTemplates(
  promoterId: string,
  db: DbAdapter,
): Promise<DynamicCreativeTemplate[]> {
  const rows = await db.query<TemplateRow>(
    `SELECT * FROM ads.dynamic_creative_templates
     WHERE promoter_id = $1 AND status = 'active'
     ORDER BY created_at DESC`,
    [promoterId],
  );
  return rows.map(mapTemplate);
}

/**
 * Renderuje dynamic creative na specifický event.
 * Simuluje rendering — v produkci by volala image generation API.
 */
export async function renderCreative(
  templateId: string,
  eventId: string,
  input: RenderCreativeInput,
  db: DbAdapter,
): Promise<RenderedCreative> {
  const templates = await db.query<TemplateRow>(
    `SELECT * FROM ads.dynamic_creative_templates WHERE id = $1 AND status = 'active'`,
    [templateId],
  );
  if (!templates[0]) {
    throw new Error('NOT_FOUND: Template not found or inactive');
  }
  const template = templates[0];

  const renderedText = renderPlaceholders(template.template_text, input);
  // V produkci: volat image generation API (např. imgix nebo vlastní service)
  const previewUrl = `https://creative-preview.internal/render?text=${encodeURIComponent(renderedText)}&bg=${encodeURIComponent(template.image_url)}`;

  return {
    id: `rendered-${Math.random().toString(36).slice(2, 9)}`,
    templateId,
    eventId,
    renderedText,
    imageUrl: template.image_url,
    ctaText: template.cta_text,
    previewUrl,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Aktivuje template (draft → active).
 */
export async function activateTemplate(
  templateId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<DynamicCreativeTemplate> {
  const rows = await db.query<TemplateRow>(
    `UPDATE ads.dynamic_creative_templates
     SET status = 'active', updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2
     RETURNING *`,
    [templateId, promoterId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Template not found');
  return mapTemplate(rows[0]);
}
