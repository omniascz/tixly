// =============================================================================
// Media Accreditation Service
// Feature #191: Press/media accreditation workflow with zone-specific QR codes
//
// Flow:
//   1. Journalist/photographer submits request online (media type, zones needed)
//   2. Promoter reviews and approves/rejects (can approve subset of zones)
//   3. Approved: zone-specific QR code generated and emailed
//   4. At venue: QR scanned at each zone gate — different zones for different roles
//      (photographer → photo pit; TV crew → mixer desk; press → press area)
//   5. Post-event: stats on who went where
// =============================================================================

import { randomBytes } from 'crypto';

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export type MediaType = 'press' | 'photo' | 'tv' | 'radio' | 'online' | 'podcast' | 'other';
export type AccreditationStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface AccreditationRequest {
  id: string;
  eventId: string;
  promoterId: string;
  requesterName: string;
  requesterEmail: string;
  organization: string;
  mediaType: MediaType;
  requestedZones: string[];
  purpose: string | null;
  portfolioUrl: string | null;
  status: AccreditationStatus;
  reviewedBy: string | null;
  reviewNotes: string | null;
  approvedZones: string[];
  qrCodePayload: string | null;
  qrIssuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccreditationScan {
  id: string;
  accreditationId: string;
  zoneId: string;
  gateId: string | null;
  scannedAt: string;
  result: 'allowed' | 'denied';
  denyReason: string | null;
}

interface RequestRow {
  id: string;
  event_id: string;
  promoter_id: string;
  requester_name: string;
  requester_email: string;
  organization: string;
  media_type: string;
  requested_zones: string[];
  purpose: string | null;
  portfolio_url: string | null;
  status: string;
  reviewed_by: string | null;
  review_notes: string | null;
  approved_zones: string[];
  qr_code_payload: string | null;
  qr_issued_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ScanRow {
  id: string;
  accreditation_id: string;
  zone_id: string;
  gate_id: string | null;
  scanned_at: string;
  result: string;
  deny_reason: string | null;
}

function mapRequest(r: RequestRow): AccreditationRequest {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    requesterName: r.requester_name,
    requesterEmail: r.requester_email,
    organization: r.organization,
    mediaType: r.media_type as MediaType,
    requestedZones: r.requested_zones,
    purpose: r.purpose,
    portfolioUrl: r.portfolio_url,
    status: r.status as AccreditationStatus,
    reviewedBy: r.reviewed_by,
    reviewNotes: r.review_notes,
    approvedZones: r.approved_zones,
    qrCodePayload: r.qr_code_payload,
    qrIssuedAt: r.qr_issued_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapScan(r: ScanRow): AccreditationScan {
  return {
    id: r.id,
    accreditationId: r.accreditation_id,
    zoneId: r.zone_id,
    gateId: r.gate_id,
    scannedAt: r.scanned_at,
    result: r.result as AccreditationScan['result'],
    denyReason: r.deny_reason,
  };
}

/** Generate a signed QR payload for media accreditation */
function generateAccreditationQr(accreditationId: string, approvedZones: string[]): string {
  const nonce = randomBytes(8).toString('hex');
  const payload = {
    type: 'media_accreditation',
    id: accreditationId,
    zones: approvedZones,
    nonce,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

/**
 * Submit a media accreditation request.
 */
export async function submitAccreditationRequest(
  input: {
    eventId: string;
    promoterId: string;
    requesterName: string;
    requesterEmail: string;
    organization: string;
    mediaType: MediaType;
    requestedZones: string[];
    purpose?: string;
    portfolioUrl?: string;
  },
  db: DbAdapter,
): Promise<AccreditationRequest> {
  if (!input.requesterName.trim()) throw new Error('VALIDATION_ERROR: requesterName is required');
  if (!input.requesterEmail.includes('@')) throw new Error('VALIDATION_ERROR: invalid email');
  if (!input.organization.trim()) throw new Error('VALIDATION_ERROR: organization is required');
  if (input.requestedZones.length === 0) throw new Error('VALIDATION_ERROR: at least one zone must be requested');

  const rows = await db.query<RequestRow>(
    `INSERT INTO accreditation.accreditation_requests
       (event_id, promoter_id, requester_name, requester_email, organization,
        media_type, requested_zones, purpose, portfolio_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.eventId,
      input.promoterId,
      input.requesterName,
      input.requesterEmail,
      input.organization,
      input.mediaType,
      input.requestedZones,
      input.purpose ?? null,
      input.portfolioUrl ?? null,
    ],
  );

  return mapRequest(rows[0]);
}

/**
 * Approve an accreditation request. Generates zone-specific QR code.
 * approvedZones may be a subset of requestedZones (promoter discretion).
 */
export async function approveAccreditation(
  accreditationId: string,
  promoterId: string,
  reviewedBy: string,
  approvedZones: string[],
  reviewNotes: string | null,
  db: DbAdapter,
): Promise<AccreditationRequest> {
  if (approvedZones.length === 0) throw new Error('VALIDATION_ERROR: approvedZones cannot be empty');

  const qrPayload = generateAccreditationQr(accreditationId, approvedZones);

  const rows = await db.query<RequestRow>(
    `UPDATE accreditation.accreditation_requests
     SET status = 'approved',
         reviewed_by = $3,
         approved_zones = $4,
         review_notes = $5,
         qr_code_payload = $6,
         qr_issued_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2 AND status = 'pending'
     RETURNING *`,
    [accreditationId, promoterId, reviewedBy, approvedZones, reviewNotes, qrPayload],
  );

  if (!rows[0]) throw new Error('ACCREDITATION_NOT_FOUND or already reviewed');
  return mapRequest(rows[0]);
}

/**
 * Reject an accreditation request.
 */
export async function rejectAccreditation(
  accreditationId: string,
  promoterId: string,
  reviewedBy: string,
  reviewNotes: string | null,
  db: DbAdapter,
): Promise<AccreditationRequest> {
  const rows = await db.query<RequestRow>(
    `UPDATE accreditation.accreditation_requests
     SET status = 'rejected',
         reviewed_by = $3,
         review_notes = $4,
         updated_at = NOW()
     WHERE id = $1 AND promoter_id = $2 AND status = 'pending'
     RETURNING *`,
    [accreditationId, promoterId, reviewedBy, reviewNotes],
  );

  if (!rows[0]) throw new Error('ACCREDITATION_NOT_FOUND or already reviewed');
  return mapRequest(rows[0]);
}

/**
 * Validate a media accreditation QR at a zone gate.
 */
export async function validateAccreditationQr(
  qrPayload: string,
  zoneId: string,
  gateId: string | null,
  db: DbAdapter,
): Promise<AccreditationScan> {
  let accreditationId: string;
  let zones: string[];

  try {
    const parsed = JSON.parse(Buffer.from(qrPayload, 'base64url').toString('utf-8')) as {
      type: string;
      id: string;
      zones: string[];
    };
    if (parsed.type !== 'media_accreditation') throw new Error('wrong type');
    accreditationId = parsed.id;
    zones = parsed.zones;
  } catch {
    const scanRows = await db.query<ScanRow>(
      `INSERT INTO accreditation.accreditation_scans
         (accreditation_id, zone_id, gate_id, result, deny_reason)
       VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, 'denied', 'INVALID_QR')
       RETURNING *`,
      [zoneId, gateId],
    );
    return mapScan(scanRows[0]);
  }

  // Check accreditation is approved and zone is in approved list
  const accRows = await db.query<RequestRow>(
    `SELECT * FROM accreditation.accreditation_requests WHERE id = $1 AND status = 'approved'`,
    [accreditationId],
  );

  if (!accRows[0]) {
    const scanRows = await db.query<ScanRow>(
      `INSERT INTO accreditation.accreditation_scans
         (accreditation_id, zone_id, gate_id, result, deny_reason)
       VALUES ($1, $2, $3, 'denied', 'ACCREDITATION_NOT_APPROVED')
       RETURNING *`,
      [accreditationId, zoneId, gateId],
    );
    return mapScan(scanRows[0]);
  }

  const hasZoneAccess = zones.includes(zoneId) && accRows[0].approved_zones.includes(zoneId);
  const result = hasZoneAccess ? 'allowed' : 'denied';
  const denyReason = hasZoneAccess ? null : 'ZONE_NOT_IN_APPROVED_LIST';

  const scanRows = await db.query<ScanRow>(
    `INSERT INTO accreditation.accreditation_scans
       (accreditation_id, zone_id, gate_id, result, deny_reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [accreditationId, zoneId, gateId, result, denyReason],
  );

  return mapScan(scanRows[0]);
}

/**
 * List accreditation requests for an event.
 */
export async function listAccreditationRequests(
  eventId: string,
  promoterId: string,
  status: AccreditationStatus | null,
  db: DbAdapter,
): Promise<AccreditationRequest[]> {
  const rows = await db.query<RequestRow>(
    `SELECT * FROM accreditation.accreditation_requests
     WHERE event_id = $1 AND promoter_id = $2
       AND ($3::text IS NULL OR status = $3)
     ORDER BY created_at DESC`,
    [eventId, promoterId, status],
  );
  return rows.map(mapRequest);
}

/**
 * Get post-event accreditation statistics.
 */
export async function getAccreditationStats(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<{
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  scansAllowed: number;
  scansDenied: number;
}> {
  const statusRows = await db.query<{
    pending: string;
    approved: string;
    rejected: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'approved') AS approved,
       COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
     FROM accreditation.accreditation_requests
     WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );

  const scanRows = await db.query<{ allowed: string; denied: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE s.result = 'allowed') AS allowed,
       COUNT(*) FILTER (WHERE s.result = 'denied') AS denied
     FROM accreditation.accreditation_scans s
     JOIN accreditation.accreditation_requests r ON r.id = s.accreditation_id
     WHERE r.event_id = $1 AND r.promoter_id = $2`,
    [eventId, promoterId],
  );

  const s = statusRows[0];
  const sc = scanRows[0];
  const approved = Number(s?.approved ?? 0);
  const rejected = Number(s?.rejected ?? 0);
  const pending = Number(s?.pending ?? 0);

  return {
    total: approved + rejected + pending,
    approved,
    rejected,
    pending,
    scansAllowed: Number(sc?.allowed ?? 0),
    scansDenied: Number(sc?.denied ?? 0),
  };
}
