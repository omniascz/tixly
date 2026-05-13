// ---------------------------------------------------------------------------
// TypeScript rozhraní pro modul mikro-pořadatele
// ---------------------------------------------------------------------------

export type MicroOrganizerStatus = 'active' | 'suspended';

export interface MicroOrganizer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Heslo NIKDY nevracíme z DB na klienta — jen interně při hashování. */
  passwordHash?: string;
  emailVerified: boolean;
  status: MicroOrganizerStatus;
  createdAt: string; // ISO 8601
}

export type MicroEventStatus = 'draft' | 'published' | 'cancelled';

export interface MicroEvent {
  id: string;
  organizerId: string;
  name: string;
  /** ISO 8601 timestamp s timezone */
  dateTime: string;
  venueName: string;
  city: string;
  capacityTotal: number;
  /** Cena vstupenky v halířích (celé číslo). 0 = volný vstup. */
  ticketPriceHalire: number;
  status: MicroEventStatus;
  /** 64-znakový hex token sloužící jako veřejný odkaz na nákup vstupenek */
  ticketLinkToken: string;
  createdAt: string; // ISO 8601
}

export interface MicroOrganizerRegistration {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}
