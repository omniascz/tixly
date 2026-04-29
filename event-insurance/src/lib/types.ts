export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export type InsuranceEventType = 'weather' | 'artist_illness' | 'venue_damage' | 'force_majeure' | 'low_attendance';

export interface EventInsurancePolicy {
  id: string;
  promoterId: string;
  eventId: string;
  provider: string;             // 'allianz' | 'axa' | 'mock'
  policyNumber?: string;
  coveredEvents: InsuranceEventType[];
  coverageAmountHalire: number;  // max výplata
  premiumHalire: number;         // cena pojistky
  status: 'quoted' | 'active' | 'claimed' | 'expired' | 'cancelled';
  coverageFrom: string;
  coverageTo: string;            // = datum akce
  createdAt: string;
}

export interface InsuranceClaim {
  id: string;
  policyId: string;
  promoterId: string;
  eventId: string;
  claimType: InsuranceEventType;
  description: string;
  requestedAmountHalire: number;
  approvedAmountHalire?: number;
  status: 'submitted' | 'under_review' | 'approved' | 'rejected' | 'paid';
  submittedAt: string;
  resolvedAt?: string;
}

export interface InsuranceQuote {
  provider: string;
  premiumHalire: number;
  coverageAmountHalire: number;
  coveredEvents: InsuranceEventType[];
  validUntil: string;
}

// Injectable API pro pojišťovnu
export type InsuranceProviderFn = (eventData: {
  eventDate: string;
  capacity: number;
  totalTicketRevenue: number;
  coveredEvents: InsuranceEventType[];
}) => Promise<InsuranceQuote>;
