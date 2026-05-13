export type ReissueReason = 'scanner_failure' | 'damaged_ticket' | 'delivery_change' | 'name_correction' | 'other';
export type ReissueStatus = 'pending' | 'approved' | 'rejected' | 'processed';
export type DeliveryMethod = 'email' | 'sms' | 'wallet_pass' | 'will_call';

export interface ReissueRequest {
  id: string;
  ticketId: string;
  orderId: string;
  userId: string;
  reason: ReissueReason;
  status: ReissueStatus;
  notes: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  newTicketId: string | null;     // created after processing
  requestedAt: Date;
  processedAt: Date | null;
}

export interface SwapRequest {
  id: string;
  fromTicketId: string;
  toTicketId: string;
  userId: string;
  reason: string;
  status: ReissueStatus;
  processedAt: Date | null;
  requestedAt: Date;
}

export interface ReissueInput {
  ticketId: string;
  orderId: string;
  userId: string;
  reason: ReissueReason;
  notes?: string;
}

export interface SwapInput {
  fromTicketId: string;
  toTicketId: string;
  userId: string;
  reason: string;
}

export interface ChangeDeliveryInput {
  ticketId: string;
  userId: string;
  newMethod: DeliveryMethod;
}

export class ReissueError extends Error {
  constructor(
    public readonly code:
      | 'TICKET_NOT_FOUND'
      | 'REQUEST_NOT_FOUND'
      | 'REQUEST_NOT_APPROVED'
      | 'ALREADY_REISSUED_TODAY'
      | 'SWAP_TICKETS_SAME'
      | 'TICKET_NOT_OWNED_BY_USER'
      | 'REQUEST_ALREADY_PROCESSED',
    message: string,
  ) {
    super(message);
    this.name = 'ReissueError';
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
