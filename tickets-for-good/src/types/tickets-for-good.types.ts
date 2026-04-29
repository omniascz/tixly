export type BeneficiaryGroup = 'teachers' | 'healthcare' | 'volunteers' | 'charity_workers' | 'students' | 'seniors' | 'other';
export type VerificationMethod = 'email_domain' | 'organization_code' | 'manual_review' | 'id_upload';
export type EligibilityStatus = 'pending' | 'verified' | 'rejected' | 'expired';
export type OfferStatus = 'draft' | 'active' | 'exhausted' | 'ended';

export interface SocialOffer {
  id: string;
  eventId: string;
  organizerId: string;
  name: string;
  beneficiaryGroup: BeneficiaryGroup;
  verificationMethod: VerificationMethod;
  allowedEmailDomains: string[];
  organizationCodes: string[];
  discountPercent: number;
  maxTickets: number;
  maxPerPerson: number;
  issuedCount: number;
  status: OfferStatus;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
}

export interface EligibilityApplication {
  id: string;
  offerId: string;
  userId: string;
  verificationMethod: VerificationMethod;
  submittedEmail: string | null;
  submittedOrgCode: string | null;
  status: EligibilityStatus;
  reviewedBy: string | null;
  rejectionReason: string | null;
  appliedAt: Date;
  verifiedAt: Date | null;
  expiresAt: Date;
}

export interface SocialTicketIssuance {
  id: string;
  applicationId: string;
  offerId: string;
  userId: string;
  ticketId: string;
  originalPriceCzk: number;
  discountCzk: number;
  finalPriceCzk: number;
  issuedAt: Date;
}

export interface OfferInput {
  eventId: string;
  organizerId: string;
  name: string;
  beneficiaryGroup: BeneficiaryGroup;
  verificationMethod: VerificationMethod;
  allowedEmailDomains?: string[];
  organizationCodes?: string[];
  discountPercent: number;
  maxTickets: number;
  maxPerPerson?: number;
  validFrom: Date;
  validUntil?: Date;
}

export interface ApplyInput {
  offerId: string;
  userId: string;
  submittedEmail?: string;
  submittedOrgCode?: string;
}

export interface OfferStats {
  offerId: string;
  issuedCount: number;
  remaining: number;
  totalDiscountGivenCzk: number;
  uniqueBeneficiaries: number;
}

export class TicketsForGoodError extends Error {
  constructor(
    public readonly code: 'OFFER_NOT_FOUND' | 'OFFER_EXHAUSTED' | 'OFFER_NOT_ACTIVE' | 'ALREADY_APPLIED' | 'DOMAIN_NOT_ALLOWED' | 'CODE_NOT_VALID' | 'APPLICATION_NOT_FOUND' | 'APPLICATION_NOT_VERIFIED' | 'MAX_PER_PERSON_EXCEEDED',
    message: string
  ) { super(message); this.name = 'TicketsForGoodError'; }
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (db: DbAdapter) => Promise<T>): Promise<T>;
}

export interface ServiceDeps { db: DbAdapter; now?: () => Date; }
