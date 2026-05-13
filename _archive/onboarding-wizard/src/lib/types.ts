export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// Stav wizardu uložený v DB mezi kroky
export interface WizardSession {
  id: string;
  promoterId: string;
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  data: WizardData;
  status: 'in_progress' | 'completed' | 'abandoned';
  createdAt: string;
  updatedAt: string;
  expiresAt: string; // 24 hodin
}

export type WizardStep =
  | 'event_basics' // Krok 1: název, datum, místo, kapacita
  | 'ticket_types' // Krok 2: typy vstupenek a ceny
  | 'payment_setup' // Krok 3: platební metody, výplata
  | 'event_details' // Krok 4: popis, obrázek, kategorie
  | 'review_publish'; // Krok 5: přehled a publikace

export interface WizardData {
  // Krok 1
  eventName?: string;
  eventDate?: string; // ISO string
  eventEndDate?: string;
  venueName?: string;
  venueAddress?: string;
  capacity?: number;
  isOnline?: boolean;

  // Krok 2
  ticketTypes?: Array<{
    name: string;
    priceHalire: number; // 0 = free
    quantity: number;
    salesStart?: string;
    salesEnd?: string;
  }>;

  // Krok 3
  paymentMethods?: Array<'gopay' | 'stripe' | 'free'>;
  payoutBankAccount?: string;

  // Krok 4
  description?: string;
  category?: string;
  imageUrl?: string;
  tags?: string[];

  // Výsledek
  createdEventId?: string;
}

export interface StepSubmission<T = unknown> {
  step: WizardStep;
  data: T;
}

export interface StepResult {
  sessionId: string;
  currentStep: WizardStep;
  nextStep: WizardStep | null; // null = wizard dokončen
  completedSteps: WizardStep[];
  progress: number; // 0-100
  errors?: Record<string, string>;
}

export interface PublishResult {
  eventId: string;
  eventUrl: string;
  ticketTypesCreated: number;
}
