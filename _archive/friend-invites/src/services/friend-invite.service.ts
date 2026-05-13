// =============================================================================
// AXS Invite — Friend reservations (Feature #50)
//
// Kupující si vybere volná místa vedle sebe a pošle link přátelům.
// Přátelé si koupi vstupenky hned, nebo se jim místo zarezervuje.
// Zvyšuje průměrnou velikost objednávky.
//
// SCHEMA: invites.* (migration 113)
// =============================================================================

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export interface FriendInvite {
  id: string;
  eventId: string;
  buyerId: string;
  inviteToken: string;
  inviteeEmail: string;
  seatHoldQty: number;
  status: InviteStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface CreateInviteInput {
  inviteeEmail: string;
  seatHoldQty: number;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

interface InviteRow {
  id: string;
  event_id: string;
  buyer_id: string;
  invite_token: string;
  invitee_email: string;
  seat_hold_qty: number;
  status: InviteStatus;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

function mapInvite(row: InviteRow): FriendInvite {
  return {
    id: row.id,
    eventId: row.event_id,
    buyerId: row.buyer_id,
    inviteToken: row.invite_token,
    inviteeEmail: row.invitee_email,
    seatHoldQty: row.seat_hold_qty,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    createdAt: row.created_at,
  };
}

/**
 * Vytvoří pozvánku pro přítele a vrátí invite token pro link.
 * Má 7 dní na přijetí; seat_hold_qty se fyzicky zadrží.
 */
export async function createFriendInvite(
  eventId: string,
  buyerId: string,
  input: CreateInviteInput,
  db: DbAdapter,
): Promise<FriendInvite> {
  if (input.seatHoldQty < 1 || input.seatHoldQty > 10) {
    throw new Error('VALIDATION_ERROR: seatHoldQty must be 1–10');
  }
  const token = Math.random().toString(36).slice(2, 15);
  const rows = await db.query<InviteRow>(
    `INSERT INTO invites.friend_invites
       (event_id, buyer_id, invite_token, invitee_email, seat_hold_qty, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '7 days')
     RETURNING *`,
    [eventId, buyerId, token, input.inviteeEmail, input.seatHoldQty],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: invite creation failed');
  return mapInvite(rows[0]);
}

/**
 * Vrátí pozvánku dle invite_token.
 */
export async function getInviteByToken(token: string, db: DbAdapter): Promise<FriendInvite | null> {
  const rows = await db.query<InviteRow>(
    `SELECT * FROM invites.friend_invites WHERE invite_token = $1`,
    [token],
  );
  return rows[0] ? mapInvite(rows[0]) : null;
}

/**
 * Přijme pozvánku — vytvoří objednávku za přítele a vrátí ji.
 * Seat hold se automaticky zruší, nová objednávka si vezme ta místa.
 */
export async function acceptFriendInvite(
  inviteId: string,
  token: string,
  inviteeId: string,
  db: DbAdapter,
): Promise<FriendInvite> {
  const rows = await db.query<InviteRow>(
    `UPDATE invites.friend_invites
     SET status = 'accepted', accepted_at = NOW()
     WHERE id = $1 AND invite_token = $2 AND status = 'pending' AND expires_at > NOW()
     RETURNING *`,
    [inviteId, token],
  );
  if (!rows[0]) {
    throw new Error('NOT_FOUND: Invite not found, expired, or already responded');
  }
  return mapInvite(rows[0]);
}

/**
 * Odmítne pozvánku — seat hold se zruší.
 */
export async function declineFriendInvite(
  inviteId: string,
  token: string,
  db: DbAdapter,
): Promise<FriendInvite> {
  const rows = await db.query<InviteRow>(
    `UPDATE invites.friend_invites
     SET status = 'declined'
     WHERE id = $1 AND invite_token = $2 AND status = 'pending'
     RETURNING *`,
    [inviteId, token],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Invite not found or already responded');
  return mapInvite(rows[0]);
}
