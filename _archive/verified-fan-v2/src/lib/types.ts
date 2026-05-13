export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export type RegistrationStatus =
  | 'registered'
  | 'selected'
  | 'purchase_window_open'
  | 'purchased'
  | 'expired'
  | 'not_selected';

export interface FanRegistration {
  id: string;
  eventId: string;
  promoterId: string;
  userId: string;
  email: string;
  status: RegistrationStatus;
  registeredAt: string;
  selectedAt?: string;
  purchaseWindowExpiresAt?: string;
  purchasedAt?: string;
}

export interface PresaleEvent {
  id: string;
  eventId: string;
  promoterId: string;
  registrationOpen: string;
  registrationClose: string;
  selectionDate: string;
  maxSelectCount: number;
  maxTicketsPerFan: number;
  status: 'upcoming' | 'registration_open' | 'selection_pending' | 'windows_open' | 'closed';
}
