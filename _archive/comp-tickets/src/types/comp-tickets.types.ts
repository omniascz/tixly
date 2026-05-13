export type CompCategory = 'artist_rider' | 'press_media' | 'vip_guest' | 'sponsor' | 'staff' | 'other';
export type CompStatus = 'issued' | 'redeemed' | 'revoked' | 'expired';
export type AllocationStatus = 'active' | 'exhausted' | 'cancelled';

export interface CompAllocation {
  id: string;
  eventId: string;
  organizerId: string;
  category: CompCategory;
  totalAllotted: number;
  totalIssued: number;
  notes: string | null;
  status: AllocationStatus;
  createdAt: Date;
}

export interface CompTicket {
  id: string;
  allocationId: string;
  eventId: string;
  organizerId: string;
  recipientName: string;
  recipientEmail: string;
  category: CompCategory;
  status: CompStatus;
  issuedAt: Date;
  redeemedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  issuedByUserId: string;
  notes: string | null;
}

export interface AllocationInput {
  eventId: string;
  organizerId: string;
  category: CompCategory;
  totalAllotted: number;
  notes?: string;
}

export interface IssueCompInput {
  allocationId: string;
  recipientName: string;
  recipientEmail: string;
  issuedByUserId: string;
  notes?: string;
}

export interface BatchIssueInput {
  allocationId: string;
  recipients: Array<{ name: string; email: string; notes?: string }>;
  issuedByUserId: string;
}

export interface AllocationStats {
  allocationId: string;
  category: CompCategory;
  totalAllotted: number;
  totalIssued: number;
  totalRedeemed: number;
  totalRevoked: number;
  remaining: number;
}

export interface AuditEntry {
  action: 'issued' | 'redeemed' | 'revoked' | 'batch_issued';
  compTicketId: string | null;
  actorUserId: string;
  details: string;
  occurredAt: Date;
}

export class CompTicketError extends Error {
  constructor(
    public readonly code:
      | 'ALLOCATION_NOT_FOUND'
      | 'TICKET_NOT_FOUND'
      | 'ALLOCATION_EXHAUSTED'
      | 'TICKET_ALREADY_REDEEMED'
      | 'TICKET_ALREADY_REVOKED'
      | 'ORGANIZER_NOT_AUTHORIZED'
      | 'BATCH_PARTIALLY_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'CompTicketError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
}
