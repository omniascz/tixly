import type { ServiceDeps } from '../lib/service-container.js';
import { LeadCaptureError } from '../lib/lead-errors.js';
import type {
  Lead,
  CreateLeadInput,
  UpdateLeadInput,
  LeadStatus,
  LeadPriority,
} from '../types/lead.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;

interface LeadRow {
  id: string;
  promoter_id: string;
  source_page: string | null;
  source: string | null;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  interest: string | null;
  status: LeadStatus;
  priority: LeadPriority;
  tags: string[] | null;
  notes: string | null;
  assigned_to_user_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  consented_at: Date | null;
  contacted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapLead(row: LeadRow): Lead {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    sourcePage: row.source_page,
    source: row.source,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    interest: row.interest,
    status: row.status,
    priority: row.priority,
    tags: row.tags ?? [],
    notes: row.notes,
    assignedToUserId: row.assigned_to_user_id,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    consentedAt: row.consented_at,
    contactedAt: row.contacted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createLead(
  input: CreateLeadInput,
  deps: ServiceDeps,
): Promise<Lead> {
  if (!input.consented) {
    throw new LeadCaptureError('CONSENT_REQUIRED');
  }
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    throw new LeadCaptureError('EMAIL_INVALID');
  }
  if (!input.firstName || !input.firstName.trim()) {
    throw new LeadCaptureError('EMAIL_INVALID');
  }

  // Rate limit: max RATE_LIMIT_MAX per email per window
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM leads.poptavky
      WHERE promoter_id = $1 AND email = $2 AND created_at >= $3`,
    [input.promoterId, email, windowStart],
  );
  if (parseInt(recent[0]?.count ?? '0', 10) >= RATE_LIMIT_MAX) {
    throw new LeadCaptureError('RATE_LIMITED');
  }

  const inserted = await deps.db.query<LeadRow>(
    `INSERT INTO leads.poptavky
       (promoter_id, source_page, source, first_name, last_name, email, phone,
        message, interest, status, priority, utm_source, utm_medium, utm_campaign,
        consented_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', 'medium', $10, $11, $12, NOW())
     RETURNING *`,
    [
      input.promoterId,
      input.sourcePage ?? null,
      input.source ?? null,
      input.firstName.trim(),
      input.lastName ?? null,
      email,
      input.phone ?? null,
      input.message ?? null,
      input.interest ?? null,
      input.utmSource ?? null,
      input.utmMedium ?? null,
      input.utmCampaign ?? null,
    ],
  );
  const lead = mapLead(inserted[0]);

  await deps.kafka.send('lead.created', {
    leadId: lead.id,
    promoterId: lead.promoterId,
    email: lead.email,
    firstName: lead.firstName,
    sourcePage: lead.sourcePage,
    createdAt: lead.createdAt,
  });

  return lead;
}

export async function getLead(
  leadId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<Lead> {
  const rows = await deps.db.query<LeadRow>(
    `SELECT * FROM leads.poptavky WHERE id = $1 AND promoter_id = $2`,
    [leadId, promoterId],
  );
  if (rows.length === 0) {
    // Anti-enumeration: 404 even if lead exists under other promoter
    throw new LeadCaptureError('LEAD_NOT_FOUND');
  }
  return mapLead(rows[0]);
}

export async function listLeads(
  promoterId: string,
  filters: {
    status?: LeadStatus;
    priority?: LeadPriority;
    tags?: string[];
    search?: string;
    from?: Date;
    to?: Date;
  },
  pagination: { limit?: number; offset?: number },
  deps: ServiceDeps,
): Promise<{
  items: Lead[];
  total: number;
  counts: Record<LeadStatus, number>;
}> {
  const where: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    where.push(`priority = $${params.length}`);
  }
  if (filters.tags && filters.tags.length > 0) {
    params.push(filters.tags);
    where.push(`tags && $${params.length}::text[]`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    where.push(
      `(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR email ILIKE $${params.length})`,
    );
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`created_at <= $${params.length}`);
  }

  const whereSql = where.join(' AND ');
  const limit = Math.min(pagination.limit ?? 50, 200);
  const offset = pagination.offset ?? 0;

  const countRows = await deps.db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM leads.poptavky WHERE ${whereSql}`,
    params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const pagedParams = [...params, limit, offset];
  const items = await deps.db.query<LeadRow>(
    `SELECT * FROM leads.poptavky
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`,
    pagedParams,
  );

  const countsRows = await deps.db.query<{ status: LeadStatus; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM leads.poptavky
      WHERE promoter_id = $1
      GROUP BY status`,
    [promoterId],
  );
  const counts: Record<LeadStatus, number> = {
    new: 0,
    contacted: 0,
    qualified: 0,
    won: 0,
    lost: 0,
  };
  for (const r of countsRows) {
    counts[r.status] = parseInt(r.count, 10);
  }

  return { items: items.map(mapLead), total, counts };
}

export async function updateLead(
  leadId: string,
  promoterId: string,
  input: UpdateLeadInput,
  deps: ServiceDeps,
): Promise<Lead> {
  // Ensure lead exists and belongs to promoter (anti-enumeration)
  await getLead(leadId, promoterId, deps);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }
  if (input.priority !== undefined) {
    params.push(input.priority);
    sets.push(`priority = $${params.length}`);
  }
  if (input.tags !== undefined) {
    params.push(input.tags);
    sets.push(`tags = $${params.length}`);
  }
  if (input.notes !== undefined) {
    params.push(input.notes);
    sets.push(`notes = $${params.length}`);
  }
  if (input.assignedToUserId !== undefined) {
    params.push(input.assignedToUserId);
    sets.push(`assigned_to_user_id = $${params.length}`);
  }
  if (input.contactedAt !== undefined) {
    params.push(input.contactedAt);
    sets.push(`contacted_at = $${params.length}`);
  }

  if (sets.length === 0) {
    return getLead(leadId, promoterId, deps);
  }

  sets.push(`updated_at = NOW()`);
  params.push(leadId);
  params.push(promoterId);

  const updated = await deps.db.query<LeadRow>(
    `UPDATE leads.poptavky
        SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND promoter_id = $${params.length}
      RETURNING *`,
    params,
  );
  if (updated.length === 0) {
    throw new LeadCaptureError('LEAD_NOT_FOUND');
  }
  return mapLead(updated[0]);
}

export async function assignLead(
  leadId: string,
  promoterId: string,
  userId: string,
  deps: ServiceDeps,
): Promise<Lead> {
  return updateLead(leadId, promoterId, { assignedToUserId: userId }, deps);
}

export async function deleteLead(
  leadId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  await getLead(leadId, promoterId, deps);
  await deps.db.execute(
    `DELETE FROM leads.poptavky WHERE id = $1 AND promoter_id = $2`,
    [leadId, promoterId],
  );
}
