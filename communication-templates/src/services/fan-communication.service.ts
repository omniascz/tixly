// =============================================================================
// Fan communication templates — Pre-built emails + SMS (Feature #60)
//
// Pre-built emaily + SMS: countdown (7 dní, 1 den), pokyny k venue,
// post-event. Propojení s email-templates a bulk-email moduly.
//
// SCHEMA: comms.* (migration 119)
// =============================================================================

export type CommunicationType = 'email' | 'sms';
export type CommunicationTemplate = 'countdown_7d' | 'countdown_1d' | 'venue_info' | 'post_event';

export interface FanCommunicationTemplate {
  id: string;
  promoterId: string;
  eventId: string;
  type: CommunicationType;
  templateName: CommunicationTemplate;
  subject?: string;          // pro email
  body: string;              // Placeholders: {{eventTitle}}, {{eventDate}}, {{eventTime}}, {{venueAddress}}, {{ticketUrl}}
  enabled: boolean;
  scheduledFor?: string;     // pro automatické odeslání
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  type: CommunicationType;
  templateName: CommunicationTemplate;
  subject?: string;
  body: string;
  scheduledFor?: string;
}

export interface PreviewInput {
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  venueAddress: string;
  ticketUrl: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface TemplateRow {
  id: string;
  promoter_id: string;
  event_id: string;
  type: string;
  template_name: string;
  subject: string | null;
  body: string;
  enabled: boolean;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

function mapTemplate(row: TemplateRow): FanCommunicationTemplate {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    eventId: row.event_id,
    type: row.type as CommunicationType,
    templateName: row.template_name as CommunicationTemplate,
    subject: row.subject,
    body: row.body,
    enabled: row.enabled,
    scheduledFor: row.scheduled_for,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function renderPlaceholders(template: string, input: PreviewInput): string {
  return template
    .replace(/\{\{eventTitle\}\}/g, input.eventTitle)
    .replace(/\{\{eventDate\}\}/g, input.eventDate)
    .replace(/\{\{eventTime\}\}/g, input.eventTime)
    .replace(/\{\{venueAddress\}\}/g, input.venueAddress)
    .replace(/\{\{ticketUrl\}\}/g, input.ticketUrl);
}

/**
 * Vytvoří nebo aktualizuje komunikační šablonu.
 * Upsert: UNIQUE(event_id, type, template_name).
 */
export async function upsertTemplate(
  promoterId: string,
  eventId: string,
  input: CreateTemplateInput,
  db: DbAdapter,
): Promise<FanCommunicationTemplate> {
  const rows = await db.query<TemplateRow>(
    `INSERT INTO comms.fan_communication_templates
       (promoter_id, event_id, type, template_name, subject, body, scheduled_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id, type, template_name) DO UPDATE SET
       subject = COALESCE(EXCLUDED.subject, comms.fan_communication_templates.subject),
       body = EXCLUDED.body,
       scheduled_for = COALESCE(EXCLUDED.scheduled_for, comms.fan_communication_templates.scheduled_for),
       updated_at = NOW()
     RETURNING *`,
    [
      promoterId,
      eventId,
      input.type,
      input.templateName,
      input.subject ?? null,
      input.body,
      input.scheduledFor ?? null,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: template upsert failed');
  return mapTemplate(rows[0]);
}

/**
 * Vrátí všechny komunikační šablony pro event (tenant-scoped).
 */
export async function listTemplates(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<FanCommunicationTemplate[]> {
  const rows = await db.query<TemplateRow>(
    `SELECT * FROM comms.fan_communication_templates
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY template_name, type`,
    [eventId, promoterId],
  );
  return rows.map(mapTemplate);
}

/**
 * Vrátí náhled šablony s vyrenderovanými placeholders.
 */
export async function previewTemplate(
  templateId: string,
  input: PreviewInput,
  db: DbAdapter,
): Promise<{ subject?: string; body: string }> {
  const templates = await db.query<TemplateRow>(
    `SELECT * FROM comms.fan_communication_templates WHERE id = $1`,
    [templateId],
  );
  if (!templates[0]) throw new Error('NOT_FOUND: Template not found');

  const template = templates[0];
  return {
    subject: template.subject ? renderPlaceholders(template.subject, input) : undefined,
    body: renderPlaceholders(template.body, input),
  };
}

/**
 * Povolí/zakáže odeslání šablony.
 */
export async function toggleTemplateEnabled(
  templateId: string,
  promoterId: string,
  enabled: boolean,
  db: DbAdapter,
): Promise<FanCommunicationTemplate> {
  const rows = await db.query<TemplateRow>(
    `UPDATE comms.fan_communication_templates
     SET enabled = $1, updated_at = NOW()
     WHERE id = $2 AND promoter_id = $3
     RETURNING *`,
    [enabled, templateId, promoterId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Template not found');
  return mapTemplate(rows[0]);
}
