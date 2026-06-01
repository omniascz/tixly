/**
 * Donation amount validation pro pay-what-you-want ticket types.
 *
 * - min_amount_hellers = floor (1 Kč default)
 * - max_amount_hellers = NULL = unlimited (jinak cap)
 * - returns chosen amount nebo error
 */
import { db } from "@/lib/db/rls-pool";


export interface DonationValidation {
  valid: boolean;
  amount: number;
  reason?: 'below_min' | 'above_max' | 'campaign_not_found' | 'campaign_inactive';
  minHalire?: number;
  maxHalire?: number | null;
}

export async function validateDonation(
  ticketTypeId: string,
  amountHalire: number,
): Promise<DonationValidation> {
  const r = await db().query<{
    min_amount_hellers: string;
    max_amount_hellers: string | null;
    is_active: boolean;
  }>(
    `SELECT min_amount_hellers, max_amount_hellers, is_active
       FROM catalog.donation_campaigns
      WHERE ticket_type_id = $1
      LIMIT 1`,
    [ticketTypeId],
  );

  if (r.rows.length === 0) {
    return { valid: false, amount: 0, reason: 'campaign_not_found' };
  }
  const c = r.rows[0];
  if (!c.is_active) {
    return { valid: false, amount: 0, reason: 'campaign_inactive' };
  }
  const min = Number(c.min_amount_hellers);
  const max = c.max_amount_hellers !== null ? Number(c.max_amount_hellers) : null;

  if (amountHalire < min) {
    return { valid: false, amount: amountHalire, reason: 'below_min', minHalire: min, maxHalire: max };
  }
  if (max !== null && amountHalire > max) {
    return { valid: false, amount: amountHalire, reason: 'above_max', minHalire: min, maxHalire: max };
  }
  return { valid: true, amount: amountHalire, minHalire: min, maxHalire: max };
}

/**
 * Record donation po paid order. Increment total_raised, donor_count.
 */
export async function recordDonation(input: {
  ticketTypeId: string;
  orderId: string;
  donorName: string | null;
  donorEmail: string | null;
  amountHalire: number;
  message?: string;
  isAnonymous: boolean;
}): Promise<{ donationId: string }> {
  const campaign = await db().query<{ id: string }>(
    `SELECT id FROM catalog.donation_campaigns WHERE ticket_type_id = $1 LIMIT 1`,
    [input.ticketTypeId],
  );
  if (campaign.rows.length === 0) {
    throw new Error('CAMPAIGN_NOT_FOUND');
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.donations
       (campaign_id, order_id, donor_name, donor_email, amount_hellers, message, is_anonymous)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      campaign.rows[0].id, input.orderId,
      input.isAnonymous ? null : input.donorName,
      input.isAnonymous ? null : input.donorEmail,
      input.amountHalire, input.message ?? null, input.isAnonymous,
    ],
  );

  await db().query(
    `UPDATE catalog.donation_campaigns
        SET total_raised_hellers = total_raised_hellers + $1,
            donor_count = donor_count + 1,
            updated_at = now()
      WHERE id = $2`,
    [input.amountHalire, campaign.rows[0].id],
  );

  return { donationId: r.rows[0].id };
}
