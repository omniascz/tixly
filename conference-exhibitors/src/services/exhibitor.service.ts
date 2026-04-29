// =============================================================================
// Exhibitor Service
// =============================================================================

import { ExhibitorError, isPgUniqueViolation } from '../lib/exhibitor-errors';

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface ExhibitorDB {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExhibitorTier = 'platinum' | 'gold' | 'silver' | 'bronze' | 'standard';
export type ExhibitorStatus = 'pending' | 'approved' | 'rejected';

export interface CreateExhibitorInput {
  companyName: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  tier?: ExhibitorTier;
  promoterId?: string;
}

export interface UpdateExhibitorInput {
  companyName?: string;
  description?: string;
  logoUrl?: string;
  websiteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  tier?: ExhibitorTier;
  status?: ExhibitorStatus;
}

export interface ListExhibitorFilters {
  status?: ExhibitorStatus;
  tier?: ExhibitorTier;
}

export interface Exhibitor {
  id: string;
  conferenceId: string;
  companyName: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  tier: ExhibitorTier;
  status: ExhibitorStatus;
  promoterId: string | null;
  staffCount: number;
  boothId: string | null;
  boothNumber: string | null;
  createdAt: string;
}

export interface ExhibitorSession {
  exhibitorId: string;
  sessionId: string;
  isSponsored: boolean;
  sessionTitle: string | null;
  sessionStartsAt: string | null;
  sessionEndsAt: string | null;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ExhibitorRow {
  id: string;
  conference_id: string;
  company_name: string;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  tier: string;
  status: string;
  promoter_id: string | null;
  staff_count?: string | number;
  booth_id: string | null;
  booth_number: string | null;
  created_at: string;
}

interface ExhibitorSessionRow {
  exhibitor_id: string;
  session_id: string;
  is_sponsored: boolean;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapExhibitor(row: ExhibitorRow): Exhibitor {
  return {
    id: row.id,
    conferenceId: row.conference_id,
    companyName: row.company_name,
    description: row.description,
    logoUrl: row.logo_url,
    websiteUrl: row.website_url,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    tier: row.tier as ExhibitorTier,
    status: row.status as ExhibitorStatus,
    promoterId: row.promoter_id,
    staffCount: typeof row.staff_count === 'string'
      ? parseInt(row.staff_count, 10)
      : (row.staff_count ?? 0),
    boothId: row.booth_id,
    boothNumber: row.booth_number,
    createdAt: row.created_at,
  };
}

function mapSession(row: ExhibitorSessionRow): ExhibitorSession {
  return {
    exhibitorId: row.exhibitor_id,
    sessionId: row.session_id,
    isSponsored: row.is_sponsored,
    sessionTitle: row.title,
    sessionStartsAt: row.starts_at,
    sessionEndsAt: row.ends_at,
  };
}

// ---------------------------------------------------------------------------
// Shared SELECT
// ---------------------------------------------------------------------------

const EXHIBITOR_SELECT = `
  SELECT e.*,
         COUNT(DISTINCT es.id) AS staff_count,
         ba.booth_id,
         b.booth_number
  FROM conference.exhibitors e
  LEFT JOIN conference.exhibitor_staff es ON es.exhibitor_id = e.id
  LEFT JOIN conference.booth_assignments ba ON ba.exhibitor_id = e.id
  LEFT JOIN conference.booths b ON b.id = ba.booth_id
`;

// ---------------------------------------------------------------------------
// 1. createExhibitor
// ---------------------------------------------------------------------------

export async function createExhibitor(
  conferenceId: string,
  input: CreateExhibitorInput,
  db: ExhibitorDB,
): Promise<Exhibitor> {
  try {
    const [row] = await db.query<ExhibitorRow>(
      `INSERT INTO conference.exhibitors
         (conference_id, company_name, description, logo_url, website_url,
          contact_email, contact_phone, tier, promoter_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *,
                 0  AS staff_count,
                 NULL::uuid AS booth_id,
                 NULL::varchar AS booth_number`,
      [
        conferenceId,
        input.companyName,
        input.description ?? null,
        input.logoUrl ?? null,
        input.websiteUrl ?? null,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
        input.tier ?? 'standard',
        input.promoterId ?? null,
      ],
    );
    return mapExhibitor(row);
  } catch (err) {
    if (isPgUniqueViolation(err)) throw new ExhibitorError('EXHIBITOR_DUPLICATE');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. getExhibitor
// ---------------------------------------------------------------------------

export async function getExhibitor(
  exhibitorId: string,
  db: ExhibitorDB,
): Promise<Exhibitor> {
  const [row] = await db.query<ExhibitorRow>(
    `${EXHIBITOR_SELECT}
     WHERE e.id = $1
     GROUP BY e.id, ba.booth_id, b.booth_number`,
    [exhibitorId],
  );
  if (!row) throw new ExhibitorError('EXHIBITOR_NOT_FOUND');
  return mapExhibitor(row);
}

// ---------------------------------------------------------------------------
// 3. listExhibitors
// ---------------------------------------------------------------------------

export async function listExhibitors(
  conferenceId: string,
  filters: ListExhibitorFilters,
  db: ExhibitorDB,
): Promise<Exhibitor[]> {
  const conditions: string[] = ['e.conference_id = $1'];
  const values: unknown[] = [conferenceId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`e.status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.tier) {
    conditions.push(`e.tier = $${idx++}`);
    values.push(filters.tier);
  }

  const rows = await db.query<ExhibitorRow>(
    `${EXHIBITOR_SELECT}
     WHERE ${conditions.join(' AND ')}
     GROUP BY e.id, ba.booth_id, b.booth_number
     ORDER BY e.created_at ASC`,
    values,
  );
  return rows.map(mapExhibitor);
}

// ---------------------------------------------------------------------------
// 4. updateExhibitor
// ---------------------------------------------------------------------------

export async function updateExhibitor(
  exhibitorId: string,
  input: UpdateExhibitorInput,
  db: ExhibitorDB,
): Promise<Exhibitor> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Partial<Record<keyof UpdateExhibitorInput, string>> = {
    companyName: 'company_name',
    description: 'description',
    logoUrl: 'logo_url',
    websiteUrl: 'website_url',
    contactEmail: 'contact_email',
    contactPhone: 'contact_phone',
    tier: 'tier',
    status: 'status',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    const val = input[key as keyof UpdateExhibitorInput];
    if (val !== undefined) {
      sets.push(`${col} = $${idx++}`);
      values.push(val);
    }
  }

  if (sets.length === 0) return getExhibitor(exhibitorId, db);

  values.push(exhibitorId);
  const [row] = await db.query<ExhibitorRow>(
    `${EXHIBITOR_SELECT}
     WHERE e.id = (
       UPDATE conference.exhibitors SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id
     )
     GROUP BY e.id, ba.booth_id, b.booth_number`,
    values,
  );
  if (!row) throw new ExhibitorError('EXHIBITOR_NOT_FOUND');
  return mapExhibitor(row);
}

// ---------------------------------------------------------------------------
// 5. approveExhibitor
// ---------------------------------------------------------------------------

export async function approveExhibitor(
  exhibitorId: string,
  db: ExhibitorDB,
): Promise<Exhibitor> {
  const [row] = await db.query<ExhibitorRow>(
    `${EXHIBITOR_SELECT}
     WHERE e.id = (
       UPDATE conference.exhibitors SET status = 'approved' WHERE id = $1 RETURNING id
     )
     GROUP BY e.id, ba.booth_id, b.booth_number`,
    [exhibitorId],
  );
  if (!row) throw new ExhibitorError('EXHIBITOR_NOT_FOUND');
  return mapExhibitor(row);
}

// ---------------------------------------------------------------------------
// 6. rejectExhibitor
// ---------------------------------------------------------------------------

export async function rejectExhibitor(
  exhibitorId: string,
  db: ExhibitorDB,
): Promise<Exhibitor> {
  const [row] = await db.query<ExhibitorRow>(
    `${EXHIBITOR_SELECT}
     WHERE e.id = (
       UPDATE conference.exhibitors SET status = 'rejected' WHERE id = $1 RETURNING id
     )
     GROUP BY e.id, ba.booth_id, b.booth_number`,
    [exhibitorId],
  );
  if (!row) throw new ExhibitorError('EXHIBITOR_NOT_FOUND');
  return mapExhibitor(row);
}

// ---------------------------------------------------------------------------
// 7. linkSessionToExhibitor
// ---------------------------------------------------------------------------

export async function linkSessionToExhibitor(
  exhibitorId: string,
  sessionId: string,
  isSponsored: boolean,
  db: ExhibitorDB,
): Promise<void> {
  await db.execute(
    `INSERT INTO conference.exhibitor_sessions (exhibitor_id, session_id, is_sponsored)
     VALUES ($1, $2, $3)
     ON CONFLICT (exhibitor_id, session_id) DO UPDATE SET is_sponsored = EXCLUDED.is_sponsored`,
    [exhibitorId, sessionId, isSponsored],
  );
}

// ---------------------------------------------------------------------------
// 8. getExhibitorSessions
// ---------------------------------------------------------------------------

export async function getExhibitorSessions(
  exhibitorId: string,
  db: ExhibitorDB,
): Promise<ExhibitorSession[]> {
  const rows = await db.query<ExhibitorSessionRow>(
    `SELECT es.exhibitor_id, es.session_id, es.is_sponsored,
            s.title, s.starts_at, s.ends_at
     FROM conference.exhibitor_sessions es
     LEFT JOIN conference.sessions s ON s.id = es.session_id
     WHERE es.exhibitor_id = $1
     ORDER BY s.starts_at ASC NULLS LAST`,
    [exhibitorId],
  );
  return rows.map(mapSession);
}
