// =============================================================================
// Collaborative event workflow — Feature #49
//
// Pozvání týmu (agent, box-office, co-promotér) do správy akce.
// Role-based access, audit log změn, schvalování úprav cen/kapacit.
//
// SCHEMA: collab.* (migration 111)
// =============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollaboratorRole = 'agent' | 'box_office' | 'co_promoter' | 'viewer';
export type CollaboratorStatus = 'pending' | 'accepted' | 'declined' | 'revoked';
export type ChangeRequestStatus = 'pending' | 'approved' | 'rejected';

export interface Collaborator {
  id: string;
  eventId: string;
  ownerPromoterId: string;
  inviteeUserId: string;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  invitedBy: string;
  invitedAt: string;
  respondedAt: string | null;
}

export interface ChangeRequest {
  id: string;
  eventId: string;
  ownerPromoterId: string;
  requestedBy: string;
  field: string;
  ticketTypeId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  status: ChangeRequestStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionNote: string | null;
  createdAt: string;
}

export interface ChangeLogEntry {
  id: string;
  eventId: string;
  actorUserId: string;
  changeRequestId: string | null;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  appliedAt: string;
}

// ---------------------------------------------------------------------------
// DB adapter
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface CollaboratorRow {
  id: string;
  event_id: string;
  owner_promoter_id: string;
  invitee_user_id: string;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  invited_by: string;
  invited_at: string;
  responded_at: string | null;
}

interface ChangeRequestRow {
  id: string;
  event_id: string;
  owner_promoter_id: string;
  requested_by: string;
  field: string;
  ticket_type_id: string | null;
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  status: ChangeRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Permissions: which roles can submit change requests
// ---------------------------------------------------------------------------

const CAN_REQUEST_CHANGES: CollaboratorRole[] = ['agent', 'box_office', 'co_promoter'];
const PROTECTED_FIELDS = ['price_halire', 'capacity', 'title', 'date_start'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCollaborator(row: CollaboratorRow): Collaborator {
  return {
    id: row.id,
    eventId: row.event_id,
    ownerPromoterId: row.owner_promoter_id,
    inviteeUserId: row.invitee_user_id,
    role: row.role,
    status: row.status,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    respondedAt: row.responded_at,
  };
}

function mapChangeRequest(row: ChangeRequestRow): ChangeRequest {
  return {
    id: row.id,
    eventId: row.event_id,
    ownerPromoterId: row.owner_promoter_id,
    requestedBy: row.requested_by,
    field: row.field,
    ticketTypeId: row.ticket_type_id,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    rejectionNote: row.rejection_note,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Collaborator functions
// ---------------------------------------------------------------------------

export async function inviteCollaborator(
  eventId: string,
  ownerPromoterId: string,
  inviteeUserId: string,
  role: CollaboratorRole,
  invitedBy: string,
  db: DbAdapter,
): Promise<Collaborator> {
  const rows = await db.query<CollaboratorRow>(
    `INSERT INTO collab.event_collaborators
       (event_id, owner_promoter_id, invitee_user_id, role, invited_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id, invitee_user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'pending',
           invited_by = EXCLUDED.invited_by,
           invited_at = NOW(),
           responded_at = NULL
     RETURNING *`,
    [eventId, ownerPromoterId, inviteeUserId, role, invitedBy],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: invite failed');
  return mapCollaborator(rows[0]);
}

export async function respondToInvitation(
  collaboratorId: string,
  inviteeUserId: string,
  accept: boolean,
  db: DbAdapter,
): Promise<Collaborator> {
  const newStatus: CollaboratorStatus = accept ? 'accepted' : 'declined';
  const rows = await db.query<CollaboratorRow>(
    `UPDATE collab.event_collaborators
     SET status = $1, responded_at = NOW()
     WHERE id = $2 AND invitee_user_id = $3 AND status = 'pending'
     RETURNING *`,
    [newStatus, collaboratorId, inviteeUserId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Invitation not found or already responded');
  return mapCollaborator(rows[0]);
}

export async function revokeCollaborator(
  collaboratorId: string,
  ownerPromoterId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE collab.event_collaborators
     SET status = 'revoked'
     WHERE id = $1 AND owner_promoter_id = $2`, // tenant-scoped
    [collaboratorId, ownerPromoterId],
  );
}

export async function listCollaborators(
  eventId: string,
  ownerPromoterId: string,
  db: DbAdapter,
): Promise<Collaborator[]> {
  const rows = await db.query<CollaboratorRow>(
    `SELECT * FROM collab.event_collaborators
     WHERE event_id = $1 AND owner_promoter_id = $2
     ORDER BY invited_at DESC`,
    [eventId, ownerPromoterId],
  );
  return rows.map(mapCollaborator);
}

// ---------------------------------------------------------------------------
// Change request functions
// ---------------------------------------------------------------------------

export async function submitChangeRequest(
  eventId: string,
  requestedBy: string,
  field: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string | undefined,
  db: DbAdapter,
  ticketTypeId?: string,
): Promise<ChangeRequest> {
  // Verify collaborator has permission to request changes
  const collab = await db.query<{ role: CollaboratorRole; owner_promoter_id: string }>(
    `SELECT role, owner_promoter_id FROM collab.event_collaborators
     WHERE event_id = $1 AND invitee_user_id = $2 AND status = 'accepted'`,
    [eventId, requestedBy],
  );
  if (!collab[0]) {
    throw new Error('FORBIDDEN: User is not an accepted collaborator for this event');
  }
  if (!CAN_REQUEST_CHANGES.includes(collab[0].role)) {
    throw new Error(`FORBIDDEN: Role '${collab[0].role}' cannot submit change requests`);
  }

  const rows = await db.query<ChangeRequestRow>(
    `INSERT INTO collab.change_requests
       (event_id, owner_promoter_id, requested_by, field, ticket_type_id,
        old_value, new_value, reason)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
     RETURNING *`,
    [
      eventId,
      collab[0].owner_promoter_id,
      requestedBy,
      field,
      ticketTypeId ?? null,
      JSON.stringify(oldValue),
      JSON.stringify(newValue),
      reason ?? null,
    ],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: change request insert failed');
  return mapChangeRequest(rows[0]);
}

export async function reviewChangeRequest(
  changeRequestId: string,
  ownerPromoterId: string,
  approve: boolean,
  reviewedBy: string,
  rejectionNote: string | undefined,
  db: DbAdapter,
): Promise<ChangeRequest> {
  const newStatus: ChangeRequestStatus = approve ? 'approved' : 'rejected';

  const rows = await db.query<ChangeRequestRow>(
    `UPDATE collab.change_requests
     SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_note = $3
     WHERE id = $4 AND owner_promoter_id = $5 AND status = 'pending' -- tenant-scoped
     RETURNING *`,
    [newStatus, reviewedBy, rejectionNote ?? null, changeRequestId, ownerPromoterId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Change request not found or already reviewed');

  if (approve) {
    // Log the approved change
    await db.execute(
      `INSERT INTO collab.change_log
         (event_id, actor_user_id, change_request_id, field, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        rows[0].event_id,
        reviewedBy,
        changeRequestId,
        rows[0].field,
        JSON.stringify(rows[0].old_value),
        JSON.stringify(rows[0].new_value),
      ],
    );
  }

  return mapChangeRequest(rows[0]);
}

export async function listChangeRequests(
  eventId: string,
  ownerPromoterId: string,
  statusFilter: ChangeRequestStatus | undefined,
  db: DbAdapter,
): Promise<ChangeRequest[]> {
  const conditions = ['event_id = $1', 'owner_promoter_id = $2'];
  const params: unknown[] = [eventId, ownerPromoterId];

  if (statusFilter) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(statusFilter);
  }

  const rows = await db.query<ChangeRequestRow>(
    `SELECT * FROM collab.change_requests
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params,
  );
  return rows.map(mapChangeRequest);
}

export async function isProtectedField(field: string): Promise<boolean> {
  return PROTECTED_FIELDS.includes(field);
}
