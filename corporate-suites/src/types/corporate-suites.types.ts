export type SuiteStatus = 'active' | 'suspended' | 'expired';
export type AllocationStatus = 'allocated' | 'accepted' | 'declined' | 'cancelled' | 'used';
export type DelegationStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface CorporateSuite {
  id: string;
  organizerId: string;         // Tixly promotér (venue)
  corporateName: string;       // název firmy
  contactEmail: string;
  totalSeats: number;
  status: SuiteStatus;
  contractStartDate: Date;
  contractEndDate: Date;
  notes: string | null;
  createdAt: Date;
}

export interface SuiteAllocation {
  id: string;
  suiteId: string;
  eventId: string;
  seatsAllocated: number;      // kolik sedadel firma dostala na tento event
  seatsUsed: number;
  requestedBy: string;         // userId firemního admina
  status: AllocationStatus;
  allocatedAt: Date;
  expiresAt: Date;             // deadline pro akceptaci / použití
}

export interface GuestInvitation {
  id: string;
  allocationId: string;
  guestEmail: string;
  guestName: string;
  invitedByUserId: string;
  status: AllocationStatus;
  ticketId: string | null;     // přiřazeno po akceptaci
  invitedAt: Date;
  respondedAt: Date | null;
  notes: string | null;
}

export interface DelegationRequest {
  id: string;
  allocationId: string;
  fromUserId: string;
  toUserId: string;
  seatsRequested: number;
  reason: string;
  status: DelegationStatus;
  requestedAt: Date;
  resolvedAt: Date | null;
}

export interface SuiteInput {
  organizerId: string;
  corporateName: string;
  contactEmail: string;
  totalSeats: number;
  contractStartDate: Date;
  contractEndDate: Date;
  notes?: string;
}

export interface AllocationInput {
  suiteId: string;
  eventId: string;
  seatsAllocated: number;
  requestedBy: string;
  expiresAt: Date;
}

export interface InviteGuestInput {
  allocationId: string;
  guestEmail: string;
  guestName: string;
  invitedByUserId: string;
  notes?: string;
}

export interface SuiteUsageReport {
  suiteId: string;
  corporateName: string;
  totalAllocations: number;
  totalSeatsAllocated: number;
  totalSeatsUsed: number;
  utilizationRate: number;     // seatsUsed / seatsAllocated
  events: Array<{ eventId: string; seatsAllocated: number; seatsUsed: number }>;
}

export class CorporateSuiteError extends Error {
  constructor(
    public readonly code: 'SUITE_NOT_FOUND' | 'ALLOCATION_NOT_FOUND' | 'INVITATION_NOT_FOUND' | 'INSUFFICIENT_SEATS' | 'SUITE_SUSPENDED' | 'ALLOCATION_EXPIRED' | 'DELEGATION_NOT_FOUND' | 'ALREADY_INVITED',
    message: string
  ) { super(message); this.name = 'CorporateSuiteError'; }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps { db: DbAdapter; now?: () => Date; }
