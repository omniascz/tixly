import {
  generateReferralCode,
  isValidReferralCode,
} from '../lib/referral-code';
import type {
  ReferralLink,
  CreateLinkOptions,
  DbAdapter,
} from '../types/referral.types';
import {
  ReferralCodeCollisionError,
  LinkNotFoundError,
} from '../types/referral.types';

// ============================================================
// Referral Link Service
// ============================================================

const MAX_CODE_ATTEMPTS = 3;

interface LinkRow {
  id: string;
  user_id: string;
  code: string;
  campaign_id: string | null;
  created_at: string;
  is_active: boolean;
  total_clicks: number;
  total_conversions: number;
  total_earned_halire: string | number;
}

function mapRow(row: LinkRow): ReferralLink {
  return {
    id: row.id,
    userId: row.user_id,
    code: row.code,
    campaignId: row.campaign_id,
    createdAt: new Date(row.created_at),
    isActive: row.is_active,
    totalClicks: row.total_clicks,
    totalConversions: row.total_conversions,
    totalEarnedHalire:
      typeof row.total_earned_halire === 'number'
        ? row.total_earned_halire
        : parseInt(row.total_earned_halire, 10),
  };
}

/**
 * Create a new referral link for the given user.
 * Retries up to MAX_CODE_ATTEMPTS times on code collision.
 */
export async function createLink(
  userId: string,
  options: CreateLinkOptions,
  db: DbAdapter,
): Promise<ReferralLink> {
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateReferralCode();

    // Verify the code is structurally valid (defensive)
    if (!isValidReferralCode(code)) {
      continue;
    }

    // Check for collision
    const existing = await db.queryOne<{ id: string }>(
      'SELECT id FROM referral.links WHERE code = $1',
      [code],
    );
    if (existing !== null) {
      if (attempt === MAX_CODE_ATTEMPTS) {
        throw new ReferralCodeCollisionError(MAX_CODE_ATTEMPTS);
      }
      continue;
    }

    const row = await db.queryOne<LinkRow>(
      `INSERT INTO referral.links
         (user_id, code, campaign_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, code, options.campaignId ?? null],
    );

    if (!row) {
      throw new Error('INSERT did not return a row');
    }

    return mapRow(row);
  }

  throw new ReferralCodeCollisionError(MAX_CODE_ATTEMPTS);
}

/**
 * Fetch a single referral link by its 8-char code.
 * Returns null when not found.
 */
export async function getLinkByCode(
  code: string,
  db: DbAdapter,
): Promise<ReferralLink | null> {
  const row = await db.queryOne<LinkRow>(
    'SELECT * FROM referral.links WHERE code = $1',
    [code],
  );
  return row ? mapRow(row) : null;
}

/**
 * Fetch all referral links belonging to a user (including inactive ones).
 */
export async function getUserLinks(
  userId: string,
  db: DbAdapter,
): Promise<ReferralLink[]> {
  const rows = await db.query<LinkRow>(
    'SELECT * FROM referral.links WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows.map(mapRow);
}

/**
 * Soft-delete a referral link (set is_active = false).
 * Verifies ownership before deactivating.
 */
export async function deactivateLink(
  linkId: string,
  userId: string,
  db: DbAdapter,
): Promise<void> {
  const existing = await db.queryOne<LinkRow>(
    'SELECT id, user_id FROM referral.links WHERE id = $1',
    [linkId],
  );

  if (!existing) {
    throw new LinkNotFoundError(linkId);
  }

  if (existing.user_id !== userId) {
    // Treat as not-found to avoid leaking link existence to wrong user
    throw new LinkNotFoundError(linkId);
  }

  await db.execute(
    'UPDATE referral.links SET is_active = FALSE WHERE id = $1',
    [linkId],
  );
}

/**
 * Atomically increment the total_clicks counter on a referral link.
 */
export async function incrementClickCount(
  linkId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    'UPDATE referral.links SET total_clicks = total_clicks + 1 WHERE id = $1',
    [linkId],
  );
}
