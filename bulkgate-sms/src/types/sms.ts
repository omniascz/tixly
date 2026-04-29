// =============================================================================
// TYPY: Generický SMS systém (BulkGate backend)
// =============================================================================

export type SmsStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'rejected';

export type SmsCategory = 'transactional' | 'marketing';

export interface SmsMessage {
  id: string;
  promoterId: string | null; // null for system-level (e.g. ticket delivery)
  recipientPhone: string; // E.164
  text: string;
  category: SmsCategory;
  status: SmsStatus;
  /** External provider's message ID */
  externalId: string | null;
  errorMessage: string | null;
  /** halíře — cost reported by provider */
  costHalire: number | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export interface SendSingleSmsInput {
  promoterId?: string;
  phone: string; // E.164
  text: string; // max 1530 chars (10 SMS segments)
  category: SmsCategory;
}

export interface SendBulkSmsInput {
  promoterId: string;
  phones: string[]; // up to 1000 per call
  text: string;
  category: 'marketing';
  /** Optional segment label for analytics */
  segmentName?: string;
}

export interface BulkSmsResult {
  total: number;
  queued: number;
  rejected: Array<{ phone: string; reason: string }>;
}

// =============================================================================
// SMS Confirmation types (6-digit code delivery)
// =============================================================================

export interface SendConfirmationSmsInput {
  phoneNumber: string; // E.164
  code: string; // 6-digit numeric code
  eventName: string;
  eventId?: string;
  promoterId?: string;
}

export interface SendBulkConfirmationSmsInput {
  phoneNumbers: string[]; // up to 1000 per call
  code: string; // 6-digit numeric code
  eventName: string;
  eventId?: string;
  promoterId?: string;
}

export interface SmsConfirmationResult {
  success: boolean;
  messageId: string;
  sentAt: Date;
  phone?: string;
}

export interface BulkConfirmationResult {
  sent: number;
  failed: number;
  results: Array<{
    phone: string;
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

export interface OptOutResult {
  success: boolean;
  optedOut: boolean;
  phone: string;
}

export interface OptOutEntry {
  phone: string;
  userId?: string;
  reason?: string;
  optedOutAt: Date;
}
