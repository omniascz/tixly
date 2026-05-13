export type SpaceStatus = 'available' | 'maintenance' | 'discontinued';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
export type PricingUnit = 'hour' | 'half_day' | 'full_day';
export type RentalCategory = 'conference' | 'celebration' | 'filming' | 'exhibition' | 'rehearsal' | 'other';

export interface RentalSpace {
  id: string;
  venueId: string;
  organizerId: string;
  name: string;
  description: string;
  capacityStanding: number;
  capacitySeated: number;
  amenities: string[];
  status: SpaceStatus;
  pricingRules: PricingRule[];
  minBookingHours: number;
  bufferMinutes: number;
  createdAt: Date;
}

export interface PricingRule {
  unit: PricingUnit;
  priceCzk: number;
  minUnits?: number;
  maxUnits?: number;
}

export interface SpaceBooking {
  id: string;
  spaceId: string;
  organizerId: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string | null;
  companyName: string | null;
  ico: string | null;
  category: RentalCategory;
  startAt: Date;
  endAt: Date;
  totalHours: number;
  status: BookingStatus;
  quotedPriceCzk: number;
  depositPaidCzk: number;
  finalPriceCzk: number | null;
  notes: string | null;
  createdAt: Date;
}

export interface BookingInput {
  spaceId: string;
  organizerId: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  companyName?: string;
  ico?: string;
  category: RentalCategory;
  startAt: Date;
  endAt: Date;
  depositPaidCzk?: number;
  notes?: string;
}

export interface AvailabilitySlot {
  startAt: Date;
  endAt: Date;
  isAvailable: boolean;
  conflictReason?: string;
}

export interface RentalRevenueSummary {
  organizerId: string;
  period: { from: Date; to: Date };
  totalBookings: number;
  completedBookings: number;
  totalRevenueCzk: number;
  averageBookingValueCzk: number;
  topCategories: Array<{ category: RentalCategory; count: number; revenueCzk: number }>;
}

export class VenueRentalError extends Error {
  constructor(
    public readonly code:
      | 'SPACE_NOT_FOUND'
      | 'BOOKING_NOT_FOUND'
      | 'SPACE_NOT_AVAILABLE'
      | 'TIME_CONFLICT'
      | 'MIN_BOOKING_HOURS'
      | 'INVALID_TIME_RANGE'
      | 'SPACE_IN_MAINTENANCE',
    message: string
  ) {
    super(message);
    this.name = 'VenueRentalError';
  }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps {
  db: DbAdapter;
  now?: () => Date;
}
