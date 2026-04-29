export type OnboardingStep = 'account' | 'profile' | 'kyc' | 'review' | 'active';

export interface OnboardingStatus {
  promoterId: string;
  currentStep: OnboardingStep;
  steps: {
    account: boolean;
    profile: boolean;
    kyc: boolean;
    activated: boolean;
  };
  promoterStatus: 'pending' | 'active' | 'suspended' | 'banned';
  kycStatus: 'not_started' | 'submitted' | 'verified' | 'rejected';
  kycRejectionNotes: string | null;
  completedAt: string | null;
}

export interface RegisterUserInput {
  email: string;
  password: string;      // min 8 znaků, musí obsahovat číslo
  firstName: string;
  lastName: string;
}

export interface CreatePromoterProfileInput {
  name: string;          // obchodní název, max 200
  legalName?: string;    // právní název
  ico: string;           // IČO — 8 číslic
  dic?: string;          // DIČ — volitelné
  phone: string;         // povinné pro KYC
  website?: string;
  defaultCurrency?: string;
  timezone?: string;
}

export interface SubmitKycInput {
  bankAccountIban: string;   // CZ IBAN validace
  bankAccountSwift: string;
  documents: KycDocumentInput[];
}

export interface KycDocumentInput {
  documentType: 'business_registration' | 'bank_statement' | 'id_document' | 'tax_certificate' | 'other';
  fileName: string;
  fileSize: number;
  storageKey: string;   // presigned upload klíč
  mimeType: string;
}

export interface AdminKycReviewInput {
  decision: 'approved' | 'rejected' | 'request_more_info';
  notes?: string;        // povinné při rejected nebo request_more_info
}

export interface KycDocument {
  id: string;
  promoterId: string;
  documentType: KycDocumentInput['documentType'];
  fileName: string;
  fileSize: number;
  storageKey: string;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
}

export interface KycReview {
  id: string;
  promoterId: string;
  adminUserId: string;
  decision: 'approved' | 'rejected' | 'request_more_info';
  notes: string | null;
  createdAt: string;
}

export interface PendingKycItem {
  promoterId: string;
  name: string;
  ico: string;
  submittedAt: string;
  documentCount: number;
}

export interface PromoterAdmin {
  id: string;
  name: string;
  legalName: string | null;
  ico: string;
  dic: string | null;
  phone: string;
  website: string | null;
  status: 'pending' | 'active' | 'suspended' | 'banned';
  kycStatus: 'not_started' | 'submitted' | 'verified' | 'rejected';
  kycNotes: string | null;
  bankAccountIban: string | null;
  bankAccountSwift: string | null;
  createdAt: string;
}
