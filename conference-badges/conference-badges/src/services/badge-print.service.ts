// =============================================================================
// Badge Print Job Service
// =============================================================================

import { BadgeError } from '../lib/badge-errors';
import {
  generateBadgeSvg,
  generateBadgePdf,
  type BadgeData,
  type BadgeTemplate as GeneratorTemplate,
  type GeneratedBadge,
} from '../lib/badge-generator';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface BadgePrintDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface BadgePrintJob {
  id: string;
  conferenceId: string;
  templateId: string;
  requestedBy: string;
  status: JobStatus;
  totalCount: number;
  processedCount: number;
  errorMessage: string | null;
  pdfUrl: string | null;
  requestedAt: string;
  completedAt: string | null;
}

// Generator function type — injectable for testing
export type BadgeGenerator = (data: BadgeData, template: GeneratorTemplate) => GeneratedBadge;

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  conference_id: string;
  template_id: string;
  requested_by: string;
  status: string;
  total_count: number;
  processed_count: number;
  error_message: string | null;
  pdf_url: string | null;
  requested_at: string;
  completed_at: string | null;
}

interface ActivationRow {
  id: string;
  pass_id: string;
  user_id: string;
  order_id: string | null;
  activated_at: string;
  access_token: string;
}

interface ActivationWithOverrideRow extends ActivationRow {
  display_name: string | null;
  display_company: string | null;
  display_role: string | null;
  badge_color: string | null;
  user_name: string | null;
}

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

interface CountRow {
  count: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapJob(row: JobRow): BadgePrintJob {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    templateId: row.template_id,
    requestedBy: row.requested_by,
    status: row.status as JobStatus,
    totalCount: row.total_count,
    processedCount: row.processed_count,
    errorMessage: row.error_message,
    pdfUrl: row.pdf_url,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
  };
}

function mapTemplateRow(row: TemplateRow): GeneratorTemplate {
  return {
    widthMm: row.width_mm,
    heightMm: row.height_mm,
    backgroundColor: row.background_color,
    accentColor: row.accent_color,
    logoUrl: row.logo_url ?? undefined,
    showPhoto: row.show_photo,
    showCompany: row.show_company,
    showQr: row.show_qr,
    showRole: row.show_role,
    fontSizeName: row.font_size_name,
    fontSizeCompany: row.font_size_company,
  };
}

// ---------------------------------------------------------------------------
// Default generator (uses the real implementation)
// ---------------------------------------------------------------------------

function defaultGenerator(data: BadgeData, template: GeneratorTemplate): GeneratedBadge {
  const svgContent = generateBadgeSvg(data, template);
  const pdfBytes = generateBadgePdf(svgContent, data);
  return { activationId: data.activationId, svgContent, pdfBytes };
}

// ---------------------------------------------------------------------------
// 1. createPrintJob
// ---------------------------------------------------------------------------

export async function createPrintJob(
  conferenceId: string,
  templateId: string,
  requestedBy: string,
  db: BadgePrintDB,
): Promise<BadgePrintJob> {
  // Count activations for this conference
  const [countRow] = await db.query<CountRow>(
    `SELECT COUNT(*) AS count
     FROM conference.pass_activations pa
     JOIN conference.multi_day_passes p ON p.id = pa.pass_id
     WHERE p.event_id = $1`,
    [conferenceId],
  );
  const totalCount = parseInt(countRow?.count ?? '0', 10);

  const [row] = await db.query<JobRow>(
    `INSERT INTO conference.badge_print_jobs
       (conference_id, template_id, requested_by, status, total_count)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING *`,
    [conferenceId, templateId, requestedBy, totalCount],
  );
  return mapJob(row);
}

// ---------------------------------------------------------------------------
// 2. processPrintJob
// ---------------------------------------------------------------------------

export async function processPrintJob(
  jobId: string,
  db: BadgePrintDB,
  generator?: BadgeGenerator,
): Promise<BadgePrintJob> {
  const gen = generator ?? defaultGenerator;

  // Fetch the job
  const [jobRow] = await db.query<JobRow>(
    `SELECT * FROM conference.badge_print_jobs WHERE id = $1`,
    [jobId],
  );
  if (!jobRow) throw new BadgeError('JOB_NOT_FOUND');
  if (jobRow.status === 'processing' || jobRow.status === 'done') {
    throw new BadgeError('JOB_ALREADY_PROCESSING');
  }

  // Mark as processing
  await db.execute(
    `UPDATE conference.badge_print_jobs SET status = 'processing' WHERE id = $1`,
    [jobId],
  );

  // Fetch template
  const [templateRow] = await db.query<TemplateRow>(
    `SELECT * FROM conference.badge_templates WHERE id = $1`,
    [jobRow.template_id],
  );

  // Fetch all activations with overrides for this conference
  const activations = await db.query<ActivationWithOverrideRow>(
    `SELECT
       pa.*,
       bo.display_name,
       bo.display_company,
       bo.display_role,
       bo.badge_color
     FROM conference.pass_activations pa
     JOIN conference.multi_day_passes p ON p.id = pa.pass_id
     LEFT JOIN conference.badge_overrides bo ON bo.activation_id = pa.id
     WHERE p.event_id = $1
     ORDER BY pa.activated_at ASC`,
    [jobRow.conference_id],
  );

  const template = mapTemplateRow(templateRow);
  const generated: GeneratedBadge[] = [];

  for (const act of activations) {
    const badgeData: BadgeData = {
      activationId: act.id,
      accessToken: act.access_token,
      displayName: act.display_name ?? act.user_name ?? `Attendee ${act.id.substring(0, 8)}`,
      displayCompany: act.display_company ?? undefined,
      displayRole: act.display_role ?? undefined,
      badgeColor: act.badge_color ?? undefined,
      qrPayload: act.access_token,
    };
    const badge = gen(badgeData, template);
    generated.push(badge);
  }

  // In a real implementation, we'd store the PDF to object storage and return a URL
  const pdfUrl = `https://cdn.tixly.example/badges/${jobId}/batch.pdf`;

  await db.execute(
    `UPDATE conference.badge_print_jobs
     SET status = 'done', processed_count = $2, pdf_url = $3, completed_at = NOW()
     WHERE id = $1`,
    [jobId, generated.length, pdfUrl],
  );

  return {
    ...mapJob(jobRow),
    status: 'done',
    processedCount: generated.length,
    pdfUrl,
    completedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 3. getJob
// ---------------------------------------------------------------------------

export async function getJob(
  jobId: string,
  db: BadgePrintDB,
): Promise<BadgePrintJob> {
  const [row] = await db.query<JobRow>(
    `SELECT * FROM conference.badge_print_jobs WHERE id = $1`,
    [jobId],
  );
  if (!row) throw new BadgeError('JOB_NOT_FOUND');
  return mapJob(row);
}

// ---------------------------------------------------------------------------
// 4. listJobs
// ---------------------------------------------------------------------------

export async function listJobs(
  conferenceId: string,
  db: BadgePrintDB,
): Promise<BadgePrintJob[]> {
  const rows = await db.query<JobRow>(
    `SELECT * FROM conference.badge_print_jobs WHERE conference_id = $1 ORDER BY requested_at DESC`,
    [conferenceId],
  );
  return rows.map(mapJob);
}

// ---------------------------------------------------------------------------
// 5. getBadgeForActivation
// ---------------------------------------------------------------------------

export interface SingleBadgeResult extends GeneratedBadge {
  displayName: string;
  displayCompany?: string;
  displayRole?: string;
}

export async function getBadgeForActivation(
  activationId: string,
  templateId: string,
  db: BadgePrintDB,
  generator?: BadgeGenerator,
): Promise<SingleBadgeResult> {
  const gen = generator ?? defaultGenerator;

  // Fetch activation with override
  const [actRow] = await db.query<ActivationWithOverrideRow>(
    `SELECT
       pa.*,
       bo.display_name,
       bo.display_company,
       bo.display_role,
       bo.badge_color
     FROM conference.pass_activations pa
     LEFT JOIN conference.badge_overrides bo ON bo.activation_id = pa.id
     WHERE pa.id = $1`,
    [activationId],
  );
  if (!actRow) throw new BadgeError('ACTIVATION_NOT_FOUND');

  // Fetch template
  const [templateRow] = await db.query<TemplateRow>(
    `SELECT * FROM conference.badge_templates WHERE id = $1`,
    [templateId],
  );
  if (!templateRow) throw new BadgeError('TEMPLATE_NOT_FOUND');

  const displayName = actRow.display_name ?? actRow.user_name ?? `Attendee ${activationId.substring(0, 8)}`;
  const displayCompany = actRow.display_company ?? undefined;
  const displayRole = actRow.display_role ?? undefined;

  const badgeData: BadgeData = {
    activationId,
    accessToken: actRow.access_token,
    displayName,
    displayCompany,
    displayRole,
    badgeColor: actRow.badge_color ?? undefined,
    qrPayload: actRow.access_token,
  };

  const template = mapTemplateRow(templateRow);
  const badge = gen(badgeData, template);

  return {
    ...badge,
    displayName,
    displayCompany,
    displayRole,
  };
}
