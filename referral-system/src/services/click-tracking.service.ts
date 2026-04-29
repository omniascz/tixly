import crypto from 'crypto';
import type {
  ReferralClick,
  TrackClickPayload,
  DbAdapter,
} from '../types/referral.types';
import { incrementClickCount } from './referral-link.service';
import { getLinkByCode } from './referral-link.service';
import { LinkNotFoundError } from '../types/referral.types';

// ============================================================
// Click Tracking Service
// ============================================================

interface ClickRow {
  id: string; // bigint comes as string from most drivers
  link_id: string;
  referrer_code: string;
  visitor_id: string;
  session_id: string;
  ip_hash: string;
  user_agent_hash: string;
  occurred_at: string;
  converted: boolean;
  converted_at: string | null;
}

function mapRow(row: ClickRow): ReferralClick {
  return {
    id: BigInt(row.id),
    linkId: row.link_id,
    referrerCode: row.referrer_code,
    visitorId: row.visitor_id,
    sessionId: row.session_id,
    ipHash: row.ip_hash,
    userAgentHash: row.user_agent_hash,
    occurredAt: new Date(row.occurred_at),
    converted: row.converted,
    convertedAt: row.converted_at ? new Date(row.converted_at) : null,
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Record a referral link click.
 * Hashes IP and User-Agent for GDPR compliance before storage.
 * Also increments the aggregate click counter on the parent link.
 */
export async function trackClick(
  payload: TrackClickPayload,
  db: DbAdapter,
): Promise<ReferralClick> {
  const link = await getLinkByCode(payload.code, db);
  if (!link || !link.isActive) {
    throw new LinkNotFoundError(payload.code);
  }

  const ipHash = sha256(payload.ip);
  const userAgentHash = sha256(payload.userAgent);

  const row = await db.queryOne<ClickRow>(
    `INSERT INTO referral.clicks
       (link_id, referrer_code, visitor_id, session_id, ip_hash, user_agent_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      link.id,
      payload.code,
      payload.visitorId,
      payload.sessionId,
      ipHash,
      userAgentHash,
    ],
  );

  if (!row) {
    throw new Error('INSERT into referral.clicks did not return a row');
  }

  // Increment the aggregate counter on the link (best-effort; non-fatal)
  await incrementClickCount(link.id, db);

  return mapRow(row);
}

/**
 * Return all clicks attributed to a given anonymous visitor, ordered by
 * most recent first — used by the attribution engine at conversion time.
 */
export async function getClicksForVisitor(
  visitorId: string,
  db: DbAdapter,
): Promise<ReferralClick[]> {
  const rows = await db.query<ClickRow>(
    `SELECT * FROM referral.clicks
     WHERE visitor_id = $1
     ORDER BY occurred_at DESC`,
    [visitorId],
  );
  return rows.map(mapRow);
}

/**
 * Mark a specific click as converted.
 */
export async function markClickConverted(
  clickId: bigint,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE referral.clicks
     SET converted = TRUE, converted_at = NOW()
     WHERE id = $1`,
    [clickId.toString()],
  );
}
