// Typy pro Verified Fan program — anti-scalping registrace a selekce.

export type SelectionMethod = 'random' | 'fifo' | 'points' | 'weighted';
export type RegistrationStatus = 'pending' | 'selected' | 'not_selected' | 'link_used' | 'link_expired';

export interface VerifiedFanConfig {
  eventId: string;
  presaleTicketTypeId: string;   // který ticket type je přístupný přes VF
  presalePrice: number;          // INTEGER haléře (může být nižší než regular)
  slots: number;                 // kolik fanů bude vybráno
  selectionMethod: SelectionMethod;
  registrationOpensAt: Date;
  registrationClosesAt: Date;
  selectionAt: Date;             // kdy proběhne výběr
  linkExpiresAfterHours: number; // za kolik hodin vyprší personalizovaný link
}

export interface FanRegistration {
  id: string;                    // UUID
  eventId: string;
  userId: string;
  loyaltyPoints: number;         // pro 'points' metodu výběru
  registeredAt: Date;
  status: RegistrationStatus;
  accessToken?: string;          // vyplněno po selekci (signed JWT)
  accessTokenExpiresAt?: Date;
  accessTokenUsedAt?: Date;
}

export interface SelectionResult {
  eventId: string;
  selectedCount: number;
  totalRegistrations: number;
  method: SelectionMethod;
  selectedAt: Date;
}

export interface AccessLinkPayload {
  registrationId: string;
  eventId: string;
  userId: string;
  presaleTicketTypeId: string;
  exp: number;                   // Unix timestamp
}

// ---------------------------------------------------------------------------
// Chybové třídy
// ---------------------------------------------------------------------------

export class RegistrationClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationClosedError';
  }
}

export class AlreadyRegisteredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyRegisteredError';
  }
}

export class AccessLinkExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessLinkExpiredError';
  }
}

export class AccessLinkAlreadyUsedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessLinkAlreadyUsedError';
  }
}

export class NotSelectedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotSelectedException';
  }
}
