export type DealStage = 'lead' | 'qualified' | 'proposal_sent' | 'negotiation' | 'won' | 'lost' | 'on_hold';
export type AdSpaceType = 'led_panel' | 'banner' | 'perimeter_board' | 'digital_screen' | 'logo_placement' | 'naming_rights';
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface SponsorLead {
  id: string;
  organizerId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  estimatedValueCzk: number;
  stage: DealStage;
  assignedToUserId: string | null;
  source: string | null;          // 'cold_outreach' | 'referral' | 'inbound'
  notes: string | null;
  nextActionAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdSpace {
  id: string;
  organizerId: string;
  venueId: string | null;
  name: string;
  type: AdSpaceType;
  description: string;
  priceCzk: number;               // cena za event/sezónu
  maxOccupancy: number;            // kolik sponzorů může sdílet (1 = exkluzivní)
  currentOccupancy: number;
  isAvailable: boolean;
}

export interface SponsorProposal {
  id: string;
  leadId: string;
  organizerId: string;
  title: string;
  status: ProposalStatus;
  lineItems: ProposalLineItem[];
  subtotalCzk: number;
  discountCzk: number;
  totalCzk: number;
  validUntil: Date;
  sentAt: Date | null;
  respondedAt: Date | null;
  createdAt: Date;
}

export interface ProposalLineItem {
  id: string;
  proposalId: string;
  adSpaceId: string | null;
  description: string;
  quantity: number;
  unitPriceCzk: number;
  totalCzk: number;
}

export interface AdSpaceBooking {
  id: string;
  adSpaceId: string;
  leadId: string;
  proposalId: string | null;
  eventId: string | null;
  startDate: Date;
  endDate: Date;
  pricePaidCzk: number;
  notes: string | null;
  createdAt: Date;
}

export interface LeadInput {
  organizerId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  estimatedValueCzk: number;
  assignedToUserId?: string;
  source?: string;
}

export interface ProposalInput {
  leadId: string;
  organizerId: string;
  title: string;
  lineItems: Array<{ adSpaceId?: string; description: string; quantity: number; unitPriceCzk: number }>;
  discountCzk?: number;
  validUntil: Date;
}

export interface PipelineSummary {
  organizerId: string;
  totalLeads: number;
  totalEstimatedValueCzk: number;
  byStage: Record<DealStage, { count: number; valueCzk: number }>;
  wonThisMonthCzk: number;
  conversionRate: number;          // won / (won + lost)
}

export class SponsorCrmError extends Error {
  constructor(
    public readonly code: 'LEAD_NOT_FOUND' | 'PROPOSAL_NOT_FOUND' | 'AD_SPACE_NOT_FOUND' | 'AD_SPACE_UNAVAILABLE' | 'PROPOSAL_EXPIRED' | 'INVALID_STAGE_TRANSITION',
    message: string
  ) { super(message); this.name = 'SponsorCrmError'; }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps { db: DbAdapter; now?: () => Date; }
