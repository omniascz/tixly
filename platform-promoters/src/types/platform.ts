export type PromoterStatus = 'pending' | 'active' | 'suspended' | 'banned' | 'closed';
export type KycStatus = 'not_started' | 'submitted' | 'verified' | 'rejected';
export type MemberRole = 'owner' | 'admin' | 'manager' | 'finance' | 'marketing' | 'staff' | 'gate';
export type MemberStatus = 'invited' | 'active' | 'deactivated';

export interface PromoterPublic {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
  brandColors: { primary?: string; secondary?: string; accent?: string };
  website: string | null;
  defaultCurrency: string;
  timezone: string;
}

export interface PromoterAdmin extends PromoterPublic {
  legalName: string | null;
  ico: string | null;
  dic: string | null;
  email: string;
  phone: string | null;
  status: PromoterStatus;
  kycStatus: KycStatus;
  kycVerifiedAt: string | null;
  kycNotes: string | null;
  bankAccountIban: string | null;
  bankAccountSwift: string | null;
  stripeAccountId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromoterMember {
  id: string;
  promoterId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  invitedAt: string;
  activatedAt: string | null;
}

export interface FeeSchedule {
  id: string;
  promoterId: string;
  name: string;
  percentageFee: number;   // celé číslo: 500 = 5.00 %
  fixedFee: number;        // haléře
  minFee: number | null;
  maxFee: number | null;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
}
