import type { ServiceDeps } from '../lib/service-container.js';
import { BulkEmailError } from '../lib/bulk-email-errors.js';
import type {
  BulkCampaign,
  BulkCampaignStatus,
  CreateCampaignInput,
  SegmentFilter,
} from '../types/bulk-email.js';
import { resolveSegment } from './segment.service.js';

interface CampaignRow {
  id: string;
  promoter_id: string;
  name: string;
  subject: string;
  html_body: string;
  segment: SegmentFilter;
  status: string;
  total_recipients: number;
  sent: number;
  failed: number;
  skipped: number;
  created_by: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

function mapCampaign(row: CampaignRow): BulkCampaign {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    subject: row.subject,
    htmlBody: row.html_body,
    segment: row.segment,
    status: row.status as BulkCampaignStatus,
    totalRecipients: row.total_recipients,
    sent: row.sent,
    failed: row.failed,
    skipped: row.skipped,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

async function loadCampaign(
  campaignId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<CampaignRow> {
  const rows = await deps.db.query<CampaignRow>(
    `SELECT * FROM bulk_email.campaigns WHERE id = $1 AND promoter_id = $2`,
    [campaignId, promoterId],
  );
  const row = rows[0];
  if (!row) throw new BulkEmailError('CAMPAIGN_NOT_FOUND');
  return row;
}

export async function createCampaign(
  input: CreateCampaignInput,
  createdBy: string,
  deps: ServiceDeps,
): Promise<BulkCampaign> {
  if (!input.name || !input.subject || !input.htmlBody) {
    throw new BulkEmailError('INVALID_SEGMENT', 'Chybí povinná pole kampaně');
  }

  const rows = await deps.db.query<CampaignRow>(
    `INSERT INTO bulk_email.campaigns
       (promoter_id, name, subject, html_body, segment, status, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6)
     RETURNING *`,
    [
      input.promoterId,
      input.name,
      input.subject,
      input.htmlBody,
      JSON.stringify(input.segment),
      createdBy,
    ],
  );
  const row = rows[0];
  if (!row) throw new BulkEmailError('INVALID_SEGMENT', 'Nepodařilo se vytvořit kampaň');
  return mapCampaign(row);
}

export async function previewSegment(
  promoterId: string,
  segment: SegmentFilter,
  deps: ServiceDeps,
): Promise<{ count: number; sample: Array<{ email: string; firstName: string }> }> {
  const recipients = await resolveSegment(promoterId, segment, deps);
  return {
    count: recipients.length,
    sample: recipients.slice(0, 10).map((r) => ({ email: r.email, firstName: r.firstName })),
  };
}

export async function startCampaign(
  campaignId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<BulkCampaign> {
  const existing = await loadCampaign(campaignId, promoterId, deps);
  if (existing.status !== 'draft') {
    throw new BulkEmailError('CAMPAIGN_ALREADY_SENT');
  }

  const recipients = await resolveSegment(promoterId, existing.segment, deps);
  if (recipients.length === 0) {
    throw new BulkEmailError('EMPTY_SEGMENT');
  }

  await deps.db.transaction(async (tx) => {
    for (const r of recipients) {
      await tx.execute(
        `INSERT INTO bulk_email.recipients (campaign_id, client_id, email, first_name, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
        [campaignId, r.clientId, r.email, r.firstName],
      );
    }
    await tx.execute(
      `UPDATE bulk_email.campaigns
       SET status = 'queued',
           total_recipients = $1,
           started_at = NOW()
       WHERE id = $2 AND promoter_id = $3`, // tenant-scoped
      [recipients.length, campaignId, promoterId],
    );
  });

  // Kick off first batch synchronously
  await processCampaignBatch(campaignId, promoterId, 100, deps);

  const refreshed = await loadCampaign(campaignId, promoterId, deps);
  return mapCampaign(refreshed);
}

export async function processCampaignBatch(
  campaignId: string,
  promoterId: string,
  batchSize: number,
  deps: ServiceDeps,
): Promise<{ processed: number; remaining: number }> {
  // Mark campaign as sending if currently queued -- tenant-scoped
  await deps.db.execute(
    `UPDATE bulk_email.campaigns
     SET status = 'sending'
     WHERE id = $1 AND promoter_id = $2 AND status = 'queued'`,
    [campaignId, promoterId],
  );

  // tenant-scoped
  const campaignRows = await deps.db.query<CampaignRow>(
    `SELECT * FROM bulk_email.campaigns WHERE id = $1 AND promoter_id = $2`,
    [campaignId, promoterId],
  );
  const campaign = campaignRows[0];
  if (!campaign) throw new BulkEmailError('CAMPAIGN_NOT_FOUND');
  if (campaign.status === 'cancelled' || campaign.status === 'completed') {
    return { processed: 0, remaining: 0 };
  }

  const recipients = await deps.db.query<{
    id: string;
    email: string;
    first_name: string;
  }>(
    `SELECT id, email, first_name
     FROM bulk_email.recipients
     WHERE campaign_id = $1 AND status = 'pending'
     LIMIT $2`,
    [campaignId, batchSize],
  );

  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    try {
      // Personalize: replace {{firstName}} token
      const html = campaign.html_body.replace(/\{\{firstName\}\}/g, r.first_name || '');
      await deps.email.send(r.email, campaign.subject, html);
      await deps.db.execute(
        `UPDATE bulk_email.recipients SET status = 'sent', sent_at = NOW() WHERE id = $1`,
        [r.id],
      );
      sent++;
    } catch (err) {
      await deps.db.execute(
        `UPDATE bulk_email.recipients SET status = 'failed', error_message = $1 WHERE id = $2`,
        [(err as Error).message, r.id],
      );
      failed++;
    }
  }

  // Update campaign counters -- tenant-scoped
  await deps.db.execute(
    `UPDATE bulk_email.campaigns
     SET sent = sent + $1, failed = failed + $2
     WHERE id = $3 AND promoter_id = $4`,
    [sent, failed, campaignId, promoterId],
  );

  const remainingRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bulk_email.recipients
     WHERE campaign_id = $1 AND status = 'pending'`,
    [campaignId],
  );
  const remaining = parseInt(remainingRows[0]?.count ?? '0', 10);

  if (remaining === 0) {
    await deps.db.execute(
      // tenant-scoped
      `UPDATE bulk_email.campaigns
       SET status = 'completed', completed_at = NOW()
       WHERE id = $1 AND promoter_id = $2 AND status = 'sending'`,
      [campaignId, promoterId],
    );
  }

  return { processed: recipients.length, remaining };
}

export async function cancelCampaign(
  campaignId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<BulkCampaign> {
  const existing = await loadCampaign(campaignId, promoterId, deps);
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    throw new BulkEmailError('CAMPAIGN_ALREADY_SENT');
  }

  await deps.db.execute(
    `UPDATE bulk_email.campaigns
     SET status = 'cancelled', completed_at = NOW()
     WHERE id = $1 AND promoter_id = $2`,
    [campaignId, promoterId],
  );
  await deps.db.execute(
    `UPDATE bulk_email.recipients
     SET status = 'skipped', error_message = 'cancelled'
     WHERE campaign_id = $1 AND status = 'pending'`,
    [campaignId],
  );

  const refreshed = await loadCampaign(campaignId, promoterId, deps);
  return mapCampaign(refreshed);
}

export async function listCampaigns(
  promoterId: string,
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{ items: BulkCampaign[]; total: number }> {
  const limit = pagination.limit ?? 50;
  const offset = pagination.offset ?? 0;

  const rows = await deps.db.query<CampaignRow>(
    `SELECT * FROM bulk_email.campaigns
     WHERE promoter_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [promoterId, limit, offset],
  );

  const totalRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bulk_email.campaigns WHERE promoter_id = $1`,
    [promoterId],
  );
  const total = parseInt(totalRows[0]?.count ?? '0', 10);

  return { items: rows.map(mapCampaign), total };
}

export { mapCampaign };
