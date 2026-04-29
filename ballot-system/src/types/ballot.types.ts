export type BallotStatus = 'draft' | 'open' | 'closed' | 'drawn' | 'cancelled';
export type EntryStatus = 'registered' | 'selected' | 'waitlisted' | 'forfeited' | 'purchased';

export interface Ballot {
  id: string;
  eventId: string;
  organizerId: string;
  name: string;
  totalSlots: number;          // number of winning slots
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  purchaseWindowHours: number; // hours to purchase after winning (default 48)
  status: BallotStatus;
  drawnAt: Date | null;
  createdAt: Date;
}

export interface BallotEntry {
  id: string;
  ballotId: string;
  userId: string;
  status: EntryStatus;
  rank: number | null;         // assigned after draw (1 = first selected)
  purchaseDeadlineAt: Date | null;
  registeredAt: Date;
  updatedAt: Date;
}

export interface BallotInput {
  eventId: string;
  organizerId: string;
  name: string;
  totalSlots: number;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  purchaseWindowHours?: number;
}

export interface DrawResult {
  ballotId: string;
  selectedCount: number;
  waitlistedCount: number;
  selected: Array<{ entryId: string; userId: string; rank: number }>;
}

export class BallotError extends Error {
  constructor(
    public readonly code:
      | 'BALLOT_NOT_FOUND'
      | 'REGISTRATION_NOT_OPEN'
      | 'ALREADY_REGISTERED'
      | 'BALLOT_NOT_CLOSED'
      | 'BALLOT_ALREADY_DRAWN'
      | 'ENTRY_NOT_FOUND'
      | 'ENTRY_NOT_SELECTED',
    message: string,
  ) {
    super(message);
    this.name = 'BallotError';
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
