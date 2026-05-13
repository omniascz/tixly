// =============================================================================
// Donation Service — Fundraising / Pay-What-You-Want Tickets
// Feature #161: Accept donations alongside regular tickets
//
// A donation campaign has a ticket type with is_donation=true.
// Buyer sets their own amount (subject to min/max).
// Promoter sees total raised and donor count.
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface DonationCampaign {
  id: string;
  eventId: string;
  promoterId: string;
  ticketTypeId: string;
  name: string;
  description: string | null;
  goalHellers: number | null;
  minAmountHellers: number;
  maxAmountHellers: number | null;
  totalRaisedHellers: number;
  donorCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Donation {
  id: string;
  campaignId: string;
  orderId: string | null;
  donorName: string | null;
  donorEmail: string | null;
  amountHellers: number;
  message: string | null;
  isAnonymous: boolean;
  donatedAt: string;
}

interface CampaignRow {
  id: string;
  event_id: string;
  promoter_id: string;
  ticket_type_id: string;
  name: string;
  description: string | null;
  goal_hellers: string | null;
  min_amount_hellers: string;
  max_amount_hellers: string | null;
  total_raised_hellers: string;
  donor_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface DonationRow {
  id: string;
  campaign_id: string;
  order_id: string | null;
  donor_name: string | null;
  donor_email: string | null;
  amount_hellers: string;
  message: string | null;
  is_anonymous: boolean;
  donated_at: string;
}

function mapCampaign(r: CampaignRow): DonationCampaign {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    ticketTypeId: r.ticket_type_id,
    name: r.name,
    description: r.description,
    goalHellers: r.goal_hellers !== null ? Number(r.goal_hellers) : null,
    minAmountHellers: Number(r.min_amount_hellers),
    maxAmountHellers: r.max_amount_hellers !== null ? Number(r.max_amount_hellers) : null,
    totalRaisedHellers: Number(r.total_raised_hellers),
    donorCount: r.donor_count,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDonation(r: DonationRow): Donation {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    orderId: r.order_id,
    donorName: r.donor_name,
    donorEmail: r.donor_email,
    amountHellers: Number(r.amount_hellers),
    message: r.message,
    isAnonymous: r.is_anonymous,
    donatedAt: r.donated_at,
  };
}

/**
 * Create a donation campaign for an event.
 */
export async function createDonationCampaign(
  input: {
    eventId: string;
    promoterId: string;
    ticketTypeId: string;
    name: string;
    description?: string;
    goalHellers?: number;
    minAmountHellers?: number;
    maxAmountHellers?: number;
  },
  db: DbAdapter,
): Promise<DonationCampaign> {
  if (!input.name.trim()) throw new Error('VALIDATION_ERROR: name is required');

  const minAmount = input.minAmountHellers ?? 100;
  if (minAmount < 1) throw new Error('VALIDATION_ERROR: minAmountHellers must be >= 1');
  if (input.maxAmountHellers !== undefined && input.maxAmountHellers < minAmount) {
    throw new Error('VALIDATION_ERROR: maxAmountHellers must be >= minAmountHellers');
  }

  const rows = await db.query<CampaignRow>(
    `INSERT INTO catalog.donation_campaigns
       (event_id, promoter_id, ticket_type_id, name, description, goal_hellers, min_amount_hellers, max_amount_hellers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.eventId,
      input.promoterId,
      input.ticketTypeId,
      input.name,
      input.description ?? null,
      input.goalHellers ?? null,
      minAmount,
      input.maxAmountHellers ?? null,
    ],
  );

  // Mark ticket type as donation type
  await db.execute(
    `UPDATE catalog.ticket_types SET is_donation = true WHERE id = $1`,
    [input.ticketTypeId],
  );

  return mapCampaign(rows[0]);
}

/**
 * Record a donation. Atomically increments campaign totals.
 */
export async function recordDonation(
  input: {
    campaignId: string;
    orderId?: string;
    donorName?: string;
    donorEmail?: string;
    amountHellers: number;
    message?: string;
    isAnonymous?: boolean;
  },
  db: DbAdapter,
): Promise<Donation> {
  // Validate against campaign limits
  const campaigns = await db.query<CampaignRow>(
    `SELECT * FROM catalog.donation_campaigns WHERE id = $1 AND is_active = true`,
    [input.campaignId],
  );

  if (!campaigns[0]) throw new Error('CAMPAIGN_NOT_FOUND or not active');

  const campaign = campaigns[0];
  const min = Number(campaign.min_amount_hellers);
  const max = campaign.max_amount_hellers !== null ? Number(campaign.max_amount_hellers) : null;

  if (input.amountHellers < min) {
    throw new Error(`VALIDATION_ERROR: amount below minimum (${min} haléřů)`);
  }
  if (max !== null && input.amountHellers > max) {
    throw new Error(`VALIDATION_ERROR: amount above maximum (${max} haléřů)`);
  }

  const rows = await db.query<DonationRow>(
    `INSERT INTO catalog.donations
       (campaign_id, order_id, donor_name, donor_email, amount_hellers, message, is_anonymous)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.campaignId,
      input.orderId ?? null,
      input.donorName ?? null,
      input.donorEmail ?? null,
      input.amountHellers,
      input.message ?? null,
      input.isAnonymous ?? false,
    ],
  );

  // Update campaign totals
  await db.execute(
    `UPDATE catalog.donation_campaigns
     SET total_raised_hellers = total_raised_hellers + $2,
         donor_count = donor_count + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [input.campaignId, input.amountHellers],
  );

  return mapDonation(rows[0]);
}

/**
 * Get campaign with progress toward goal.
 */
export async function getCampaignProgress(
  campaignId: string,
  db: DbAdapter,
): Promise<DonationCampaign & { progressPct: number | null }> {
  const rows = await db.query<CampaignRow>(
    `SELECT * FROM catalog.donation_campaigns WHERE id = $1`,
    [campaignId],
  );

  if (!rows[0]) throw new Error('CAMPAIGN_NOT_FOUND');

  const campaign = mapCampaign(rows[0]);
  const progressPct = campaign.goalHellers !== null && campaign.goalHellers > 0
    ? Math.min(100, Math.round((campaign.totalRaisedHellers / campaign.goalHellers) * 100))
    : null;

  return { ...campaign, progressPct };
}

/**
 * List donors for a campaign (promoter view — hides anonymous names).
 */
export async function listDonors(
  campaignId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<Donation[]> {
  // Verify ownership
  const ownerCheck = await db.query<{ id: string }>(
    `SELECT id FROM catalog.donation_campaigns WHERE id = $1 AND promoter_id = $2`,
    [campaignId, promoterId],
  );
  if (!ownerCheck[0]) throw new Error('CAMPAIGN_NOT_FOUND');

  const rows = await db.query<DonationRow>(
    `SELECT * FROM catalog.donations WHERE campaign_id = $1 ORDER BY donated_at DESC`,
    [campaignId],
  );

  return rows.map((r) => {
    const d = mapDonation(r);
    if (d.isAnonymous) {
      return { ...d, donorName: null, donorEmail: null };
    }
    return d;
  });
}
