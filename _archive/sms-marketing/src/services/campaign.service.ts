// =============================================================================
// Campaign service — build, schedule, execute, and track SMS campaigns
//
// Core business logic:
// - Create campaigns with segment-based targeting
// - Schedule for future delivery or send immediately
// - Batch send via BulkGate (100 recipients per request)
// - Track delivery metrics and performance
// =============================================================================

import type { Campaign, CampaignStatus, CampaignStatistic, SegmentRule } from '../lib/types.js';
import { evaluateSegments } from './segmentation.service.js';

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface BulkGateClient {
  sendBulk(phones: string[], text: string): Promise<{ accepted: string[]; rejected: Array<{ phone: string; reason: string }> }>;
}

// =============================================================================
// Row types for DB mapping
// =============================================================================

interface CampaignRow {
  id: string;
  promoter_id: string;
  name: string;
  type: string;
  body: string;
  segment_rules: string; // JSON
  scheduled_at: string | null;
  sent_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CampaignStatRow {
  campaign_id: string;
  sent_count: number;
  failed_count: number;
  bounced_count: number;
  click_count: number;
  unsubscribe_count: number;
}

interface UserPhoneRow {
  id: string;
  phone: string;
}

// =============================================================================
// Validation
// =============================================================================

function validateCampaignBody(body: string): void {
  if (!body || body.trim().length === 0) {
    throw new Error('VALIDATION_ERROR: Campaign body cannot be empty');
  }
  if (body.length > 160) {
    throw new Error(`VALIDATION_ERROR: SMS body exceeds 160 characters (got ${body.length})`);
  }
}

function validateSegmentRules(rules: SegmentRule[]): void {
  const validTypes = ['event_type', 'geography', 'age', 'purchase_history', 'engagement_level'];
  const validOperators = ['equals', 'in', 'gte', 'lte', 'between'];

  for (const rule of rules) {
    if (!validTypes.includes(rule.type)) {
      throw new Error(`VALIDATION_ERROR: Invalid segment type "${rule.type}"`);
    }
    if (!validOperators.includes(rule.operator)) {
      throw new Error(`VALIDATION_ERROR: Invalid segment operator "${rule.operator}"`);
    }
    if (!rule.values || rule.values.length === 0) {
      throw new Error('VALIDATION_ERROR: Segment rule must have at least one value');
    }
  }
}

// =============================================================================
// Mapping functions
// =============================================================================

function mapCampaignRow(row: CampaignRow, stats: CampaignStatistic): Campaign {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    name: row.name,
    type: row.type as any,
    body: row.body,
    segmentRules: JSON.parse(row.segment_rules),
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    status: row.status as CampaignStatus,
    stats,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStatisticRow(row: CampaignStatRow): CampaignStatistic {
  return {
    campaignId: row.campaign_id,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    bouncedCount: row.bounced_count,
    clickCount: row.click_count,
    unsubscribeCount: row.unsubscribe_count,
  };
}

// =============================================================================
// Core operations
// =============================================================================

/**
 * Create a new campaign with validation.
 * Status starts as 'pending' — must call publishCampaign() to schedule/send.
 */
export async function createCampaign(
  promoterId: string,
  name: string,
  type: 'informational' | 'promotional',
  body: string,
  segmentRules: SegmentRule[],
  db: DbAdapter,
): Promise<Campaign> {
  validateCampaignBody(body);
  validateSegmentRules(segmentRules);

  return db.transaction(async (tx) => {
    // Create campaign
    const campaignRows = await tx.query<CampaignRow>(
      `INSERT INTO sms_marketing.campaigns
         (promoter_id, name, type, body, segment_rules, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [promoterId, name, type, body, JSON.stringify(segmentRules), 'pending'],
    );

    if (!campaignRows[0]) throw new Error('INTERNAL_ERROR: Campaign creation failed');
    const campaign = campaignRows[0];

    // Create associated statistics record
    await tx.execute(
      `INSERT INTO sms_marketing.campaign_statistics
         (campaign_id, sent_count, failed_count, bounced_count, click_count, unsubscribe_count)
       VALUES ($1, 0, 0, 0, 0, 0)`,
      [campaign.id],
    );

    const statRows = await tx.query<CampaignStatRow>(
      `SELECT * FROM sms_marketing.campaign_statistics WHERE campaign_id = $1`,
      [campaign.id],
    );

    return mapCampaignRow(campaign, mapStatisticRow(statRows[0]));
  });
}

/**
 * Publish a campaign for scheduled or immediate delivery.
 * - If scheduledAt <= now: status becomes 'sent'
 * - If scheduledAt > now: status becomes 'scheduled'
 * Must have recipients (segment must match at least one user).
 */
export async function publishCampaign(
  campaignId: string,
  scheduledAt: string,
  db: DbAdapter,
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    // Fetch campaign
    const rows = await tx.query<CampaignRow>(
      `SELECT * FROM sms_marketing.campaigns WHERE id = $1`,
      [campaignId],
    );

    if (!rows[0]) throw new Error('NOT_FOUND: Campaign not found');

    const campaign = rows[0];

    if (campaign.status === 'sent') {
      throw new Error('VALIDATION_ERROR: Cannot republish a sent campaign');
    }

    // Determine status based on time
    const now = new Date();
    const scheduledTime = new Date(scheduledAt);
    const newStatus: CampaignStatus = scheduledTime <= now ? 'sent' : 'scheduled';

    // Update campaign
    await tx.execute(
      `UPDATE sms_marketing.campaigns
       SET scheduled_at = $1, status = $2, updated_at = NOW()
       WHERE id = $3`,
      [scheduledAt, newStatus, campaignId],
    );

    // Fetch updated campaign
    const updatedRows = await tx.query<CampaignRow>(
      `SELECT * FROM sms_marketing.campaigns WHERE id = $1`,
      [campaignId],
    );

    const statRows = await tx.query<CampaignStatRow>(
      `SELECT * FROM sms_marketing.campaign_statistics WHERE campaign_id = $1`,
      [campaignId],
    );

    return mapCampaignRow(updatedRows[0], mapStatisticRow(statRows[0]));
  });
}

/**
 * Get all recipients matching the campaign's segment rules.
 * Applies AND logic — user must match ALL rules.
 */
export async function getRecipientSegment(
  promoterId: string,
  segmentRules: SegmentRule[],
  db: DbAdapter,
): Promise<Array<{ userId: string; phone: string }>> {
  // Fetch all opted-in users for this promoter's events
  const users = await db.query<UserPhoneRow>(
    `SELECT DISTINCT u.id, so.phone_number as phone
     FROM users u
     INNER JOIN sms_marketing.sms_optins so ON so.buyer_id = u.id
     INNER JOIN events e ON e.id = so.event_id
     WHERE e.promoter_id = $1 AND so.opted = true`,
    [promoterId],
  );

  // Filter by segment rules (AND logic)
  const matches: Array<{ userId: string; phone: string }> = [];

  for (const user of users) {
    const matches_all = await evaluateSegments(user.id, segmentRules, db);
    if (matches_all) {
      matches.push({ userId: user.id, phone: user.phone });
    }
  }

  return matches;
}

/**
 * Execute campaign send if:
 * - Status is 'scheduled'
 * - Current time >= scheduledAt
 * Batches send in groups of 100 via BulkGate.
 */
export async function executeCampaignSend(
  campaignId: string,
  db: DbAdapter,
  bulkGate: BulkGateClient,
): Promise<{ sentCount: number; failedCount: number }> {
  return db.transaction(async (tx) => {
    // Fetch campaign
    const rows = await tx.query<CampaignRow>(
      `SELECT * FROM sms_marketing.campaigns WHERE id = $1`,
      [campaignId],
    );

    if (!rows[0]) throw new Error('NOT_FOUND: Campaign not found');

    const campaign = rows[0];

    // Check status and timing
    if (campaign.status !== 'scheduled') {
      throw new Error(`VALIDATION_ERROR: Campaign status is ${campaign.status}, not scheduled`);
    }

    const now = new Date();
    const scheduledTime = new Date(campaign.scheduled_at!);

    if (now < scheduledTime) {
      throw new Error('VALIDATION_ERROR: Campaign is not yet scheduled for send');
    }

    // Get recipients
    const rules = JSON.parse(campaign.segment_rules) as SegmentRule[];
    const recipients = await getRecipientSegment(campaign.promoter_id, rules, tx);

    if (recipients.length === 0) {
      throw new Error('VALIDATION_ERROR: No recipients match campaign segment');
    }

    // Batch send
    let sentCount = 0;
    let failedCount = 0;
    const batchSize = 100;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const phones = batch.map(r => r.phone);

      const result = await bulkGate.sendBulk(phones, campaign.body);
      sentCount += result.accepted.length;
      failedCount += result.rejected.length;
    }

    // Update campaign status and timestamps
    await tx.execute(
      `UPDATE sms_marketing.campaigns
       SET status = $1, sent_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      ['sent', campaignId],
    );

    // Update stats
    await tx.execute(
      `UPDATE sms_marketing.campaign_statistics
       SET sent_count = sent_count + $1, failed_count = failed_count + $2
       WHERE campaign_id = $3`,
      [sentCount, failedCount, campaignId],
    );

    return { sentCount, failedCount };
  });
}

/**
 * Update campaign statistics (typically after BulkGate callback).
 */
export async function updateCampaignStats(
  campaignId: string,
  sentCount: number,
  failedCount: number,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE sms_marketing.campaign_statistics
     SET sent_count = $1, failed_count = $2
     WHERE campaign_id = $3`,
    [sentCount, failedCount, campaignId],
  );
}

/**
 * Get full campaign details with statistics.
 */
export async function getCampaignPerformance(
  campaignId: string,
  db: DbAdapter,
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    const rows = await tx.query<CampaignRow>(
      `SELECT * FROM sms_marketing.campaigns WHERE id = $1`,
      [campaignId],
    );

    if (!rows[0]) throw new Error('NOT_FOUND: Campaign not found');

    const statRows = await tx.query<CampaignStatRow>(
      `SELECT * FROM sms_marketing.campaign_statistics WHERE campaign_id = $1`,
      [campaignId],
    );

    if (!statRows[0]) throw new Error('INTERNAL_ERROR: Campaign statistics not found');

    return mapCampaignRow(rows[0], mapStatisticRow(statRows[0]));
  });
}

/**
 * Get paginated list of campaigns for a promoter.
 */
export async function listCampaigns(
  promoterId: string,
  db: DbAdapter,
  limit: number = 20,
  offset: number = 0,
): Promise<{ campaigns: Campaign[]; total: number }> {
  return db.transaction(async (tx) => {
    // Get total count
    const countRows = await tx.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM sms_marketing.campaigns
       WHERE promoter_id = $1 AND status != $2`,
      [promoterId, 'archived'],
    );
    const total = countRows[0]?.count ?? 0;

    // Get paginated results
    const campaignRows = await tx.query<CampaignRow>(
      `SELECT * FROM sms_marketing.campaigns
       WHERE promoter_id = $1 AND status != $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [promoterId, 'archived', limit, offset],
    );

    const campaigns = await Promise.all(
      campaignRows.map(async (row) => {
        const statRows = await tx.query<CampaignStatRow>(
          `SELECT * FROM sms_marketing.campaign_statistics WHERE campaign_id = $1`,
          [row.id],
        );
        return mapCampaignRow(row, mapStatisticRow(statRows[0]));
      }),
    );

    return { campaigns, total };
  });
}

/**
 * Get campaign by ID.
 */
export async function getCampaign(
  campaignId: string,
  db: DbAdapter,
): Promise<Campaign> {
  return getCampaignPerformance(campaignId, db);
}

/**
 * Update campaign (only allowed if not sent).
 */
export async function updateCampaign(
  campaignId: string,
  updates: Partial<{ name: string; type: string; body: string; segmentRules: SegmentRule[] }>,
  db: DbAdapter,
): Promise<Campaign> {
  return db.transaction(async (tx) => {
    // Fetch current campaign
    const rows = await tx.query<CampaignRow>(
      `SELECT * FROM sms_marketing.campaigns WHERE id = $1`,
      [campaignId],
    );

    if (!rows[0]) throw new Error('NOT_FOUND: Campaign not found');

    const campaign = rows[0];

    if (campaign.status === 'sent') {
      throw new Error('VALIDATION_ERROR: Cannot update a sent campaign');
    }

    // Validate updates
    if (updates.body) validateCampaignBody(updates.body);
    if (updates.segmentRules) validateSegmentRules(updates.segmentRules);

    // Build update query
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (updates.name) {
      setClauses.push(`name = $${paramIdx++}`);
      params.push(updates.name);
    }
    if (updates.type) {
      setClauses.push(`type = $${paramIdx++}`);
      params.push(updates.type);
    }
    if (updates.body) {
      setClauses.push(`body = $${paramIdx++}`);
      params.push(updates.body);
    }
    if (updates.segmentRules) {
      setClauses.push(`segment_rules = $${paramIdx++}`);
      params.push(JSON.stringify(updates.segmentRules));
    }

    params.push(campaignId);

    await tx.execute(
      `UPDATE sms_marketing.campaigns SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params,
    );

    // Fetch updated campaign
    return getCampaignPerformance(campaignId, tx);
  });
}

/**
 * Soft delete campaign (set status to 'archived').
 */
export async function deleteCampaign(
  campaignId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE sms_marketing.campaigns SET status = $1, updated_at = NOW() WHERE id = $2`,
    ['archived', campaignId],
  );
}
