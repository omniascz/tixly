export type TierStatus = 'draft' | 'active' | 'paused' | 'sold_out';

export interface PremiumTier {
  id: string;
  eventId: string;
  organizerId: string;
  name: string;              // e.g., "VIP Front Row"
  description: string;
  multiplier: number;        // price = face_value * multiplier, must be >= 1.1
  status: TierStatus;
  maxSeats: number;
  availableSeats: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PremiumSeat {
  id: string;
  tierId: string;
  eventId: string;
  seatId: string;
  section: string;
  row: string;
  number: string;
  faceValueCzk: number;
  premiumPriceCzk: number;   // = faceValueCzk * tier.multiplier
  isPurchased: boolean;
  purchasedAt: Date | null;
  purchasedByUserId: string | null;
}

export interface TierInput {
  eventId: string;
  organizerId: string;
  name: string;
  description: string;
  multiplier: number;        // must be >= 1.1
  maxSeats: number;
}

export interface AddSeatsInput {
  tierId: string;
  seats: Array<{
    seatId: string;
    section: string;
    row: string;
    number: string;
    faceValueCzk: number;
  }>;
}

export interface PurchaseInput {
  tierId: string;
  seatId: string;
  userId: string;
}

export interface TierStats {
  tierId: string;
  totalSeats: number;
  soldSeats: number;
  availableSeats: number;
  revenue: number;           // sum of premiumPriceCzk for sold seats
  sellThroughRate: number;   // soldSeats / totalSeats
}

export class PremiumInventoryError extends Error {
  constructor(
    public readonly code:
      | 'TIER_NOT_FOUND'
      | 'SEAT_NOT_FOUND'
      | 'SEAT_ALREADY_PURCHASED'
      | 'TIER_NOT_ACTIVE'
      | 'INVALID_MULTIPLIER'
      | 'NO_AVAILABLE_SEATS'
      | 'ORGANIZER_NOT_AUTHORIZED',
    message: string,
  ) {
    super(message);
    this.name = 'PremiumInventoryError';
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
