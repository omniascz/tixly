// =============================================================================
// Fan Share Service — P2P Marketing with Rewards
// Feature #25: Fans earn rewards (cashback, VIP upgrade, discount) for sharing
// Builds on affiliate-tracking infrastructure
// =============================================================================

import { randomBytes } from 'crypto';

export interface Campaign {
  id: string;
  eventId: string;
  promoterId: string;
  isActive: boolean;
  rewardType: 'cashback' | 'vip_upgrade' | 'discount_code' | 'credit';
  rewardValueHellers?: number;
  rewardDiscountPct?: number;
  rewardCodePrefix?: string;
  maxReferrals?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareLink {
  id: string;
  campaignId: string;
  eventId: string;
  fanUserId: string;
  shareCode: string;
  shareUrl: string;
  referralCount: number;
  conversionCount: number;
  totalEarnedHellers: number;
  isActive: boolean;
  createdAt: string;
}

export interface Conversion {
  id: string;
  shareLinkId: string;
  orderId: string;
  referredUserId: string;
  rewardIssued: boolean;
  rewardType?: string;
  rewardValueHellers?: number;
  rewardCode?: string;
  createdAt: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface CampaignRow {
  id: string;
  event_id: string;
  promoter_id: string;
  is_active: boolean;
  reward_type: string;
  reward_value_hellers: number | null;
  reward_discount_pct: number | null;
  reward_code_prefix: string | null;
  max_referrals: number | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ShareLinkRow {
  id: string;
  campaign_id: string;
  event_id: string;
  fan_user_id: string;
  share_code: string;
  referral_count: number;
  conversion_count: number;
  total_earned_hellers: number;
  is_active: boolean;
  created_at: string;
}

interface ConversionRow {
  id: string;
  share_link_id: string;
  order_id: string;
  referred_user_id: string;
  reward_issued: boolean;
  reward_type: string | null;
  reward_value_hellers: number | null;
  reward_code: string | null;
  created_at: string;
}

function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    isActive: row.is_active,
    rewardType: row.reward_type as any,
    rewardValueHellers: row.reward_value_hellers || undefined,
    rewardDiscountPct: row.reward_discount_pct || undefined,
    rewardCodePrefix: row.reward_code_prefix || undefined,
    maxReferrals: row.max_referrals || undefined,
    expiresAt: row.expires_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapShareLink(row: ShareLinkRow, baseUrl: string): ShareLink {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    eventId: row.event_id,
    fanUserId: row.fan_user_id,
    shareCode: row.share_code,
    shareUrl: `${baseUrl}/r/${row.share_code}`,
    referralCount: row.referral_count,
    conversionCount: row.conversion_count,
    totalEarnedHellers: row.total_earned_hellers,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function mapConversion(row: ConversionRow): Conversion {
  return {
    id: row.id,
    shareLinkId: row.share_link_id,
    orderId: row.order_id,
    referredUserId: row.referred_user_id,
    rewardIssued: row.reward_issued,
    rewardType: row.reward_type || undefined,
    rewardValueHellers: row.reward_value_hellers || undefined,
    rewardCode: row.reward_code || undefined,
    createdAt: row.created_at,
  };
}

/** Generate a URL-safe share code (8 chars base62). */
function generateShareCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(8);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join('');
}

/**
 * Create a fan share campaign for an event.
 */
export async function createCampaign(
  eventId: string,
  promoterId: string,
  config: Pick<Campaign, 'rewardType' | 'rewardValueHellers' | 'rewardDiscountPct' | 'rewardCodePrefix' | 'maxReferrals' | 'expiresAt'>,
  db: DbAdapter,
): Promise<Campaign> {
  if (!config.rewardType) {
    throw new Error('VALIDATION_ERROR: rewardType required');
  }

  const rows = await db.query<CampaignRow>(
    `INSERT INTO fan_share.campaigns
       (event_id, promoter_id, reward_type, reward_value_hellers, reward_discount_pct,
        reward_code_prefix, max_referrals, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      eventId,
      promoterId,
      config.rewardType,
      config.rewardValueHellers || null,
      config.rewardDiscountPct || null,
      config.rewardCodePrefix || null,
      config.maxReferrals || null,
      config.expiresAt || null,
    ],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: campaign creation failed');
  return mapCampaign(rows[0]);
}

/**
 * Fan generates their personal share link for an event.
 * Idempotent — same fan gets same link.
 */
export async function createShareLink(
  campaignId: string,
  eventId: string,
  fanUserId: string,
  db: DbAdapter,
  baseUrl: string = 'https://tixly.io',
): Promise<ShareLink> {
  const shareCode = generateShareCode();

  const rows = await db.query<ShareLinkRow>(
    `INSERT INTO fan_share.share_links
       (campaign_id, event_id, fan_user_id, share_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (campaign_id, event_id, fan_user_id)
     DO UPDATE SET is_active = true
     RETURNING *`,
    [campaignId, eventId, fanUserId, shareCode],
  );

  if (!rows[0]) throw new Error('INTERNAL_ERROR: share link creation failed');
  return mapShareLink(rows[0], baseUrl);
}

/**
 * Track a click on a share link (increment referral_count).
 */
export async function trackClick(
  shareCode: string,
  db: DbAdapter,
): Promise<ShareLink | null> {
  const rows = await db.query<ShareLinkRow>(
    `UPDATE fan_share.share_links
     SET referral_count = referral_count + 1
     WHERE share_code = $1 AND is_active = true
     RETURNING *`,
    [shareCode],
  );
  return rows[0] ? mapShareLink(rows[0], '') : null;
}

/**
 * Record a conversion — fan share link led to a ticket purchase.
 * Issues reward to fan. Idempotent on (share_link_id, order_id).
 */
export async function recordConversion(
  shareCode: string,
  orderId: string,
  referredUserId: string,
  db: DbAdapter,
): Promise<Conversion> {
  return db.transaction(async (tx) => {
    // Get share link + campaign
    const linkRows = await tx.query<ShareLinkRow & { reward_type: string; reward_value_hellers: number | null; reward_discount_pct: number | null; reward_code_prefix: string | null }>(
      `SELECT sl.*, c.reward_type, c.reward_value_hellers, c.reward_discount_pct, c.reward_code_prefix
       FROM fan_share.share_links sl
       JOIN fan_share.campaigns c ON c.id = sl.campaign_id
       WHERE sl.share_code = $1 AND sl.is_active = true`,
      [shareCode],
    );

    if (!linkRows[0]) throw new Error('SHARE_LINK_NOT_FOUND');

    const link = linkRows[0];
    const rewardCode = link.reward_type === 'discount_code'
      ? `${link.reward_code_prefix || 'FANSHARE-'}${generateShareCode()}`
      : null;

    // Insert conversion (idempotent)
    const convRows = await tx.query<ConversionRow>(
      `INSERT INTO fan_share.conversions
         (share_link_id, order_id, referred_user_id, reward_type, reward_value_hellers, reward_code, reward_issued)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (share_link_id, order_id) DO NOTHING
       RETURNING *`,
      [link.id, orderId, referredUserId, link.reward_type, link.reward_value_hellers, rewardCode],
    );

    if (!convRows[0]) throw new Error('DUPLICATE_CONVERSION');

    // Increment conversion count + earned amount on share link
    await tx.execute(
      `UPDATE fan_share.share_links
       SET conversion_count = conversion_count + 1,
           total_earned_hellers = total_earned_hellers + $2
       WHERE id = $1`,
      [link.id, link.reward_value_hellers || 0],
    );

    return mapConversion(convRows[0]);
  });
}

/**
 * Get a fan's share link for an event.
 */
export async function getFanShareLink(
  eventId: string,
  fanUserId: string,
  db: DbAdapter,
  baseUrl: string = 'https://tixly.io',
): Promise<ShareLink | null> {
  const rows = await db.query<ShareLinkRow>(
    `SELECT sl.* FROM fan_share.share_links sl
     JOIN fan_share.campaigns c ON c.id = sl.campaign_id
     WHERE sl.event_id = $1 AND sl.fan_user_id = $2 AND sl.is_active = true
     ORDER BY sl.created_at DESC
     LIMIT 1`,
    [eventId, fanUserId],
  );
  return rows[0] ? mapShareLink(rows[0], baseUrl) : null;
}

/**
 * Get conversions for a share link (fan's earning history).
 */
export async function getShareLinkConversions(
  shareCode: string,
  db: DbAdapter,
): Promise<Conversion[]> {
  const rows = await db.query<ConversionRow>(
    `SELECT c.* FROM fan_share.conversions c
     JOIN fan_share.share_links sl ON sl.id = c.share_link_id
     WHERE sl.share_code = $1
     ORDER BY c.created_at DESC`,
    [shareCode],
  );
  return rows.map(mapConversion);
}

/**
 * Get campaign details.
 */
export async function getCampaign(
  campaignId: string,
  db: DbAdapter,
): Promise<Campaign | null> {
  const rows = await db.query<CampaignRow>(
    `SELECT * FROM fan_share.campaigns WHERE id = $1`,
    [campaignId],
  );
  return rows[0] ? mapCampaign(rows[0]) : null;
}

/**
 * Get all active campaigns for an event.
 */
export async function getEventCampaigns(
  eventId: string,
  db: DbAdapter,
): Promise<Campaign[]> {
  const rows = await db.query<CampaignRow>(
    `SELECT * FROM fan_share.campaigns
     WHERE event_id = $1 AND is_active = true
     ORDER BY created_at DESC`,
    [eventId],
  );
  return rows.map(mapCampaign);
}
