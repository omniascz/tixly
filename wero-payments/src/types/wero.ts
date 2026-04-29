// =============================================================================
// Wero — typové definice pro SEPA Instant A2A platby
// =============================================================================

export type WeroPaymentStatus =
  | 'initiated'
  | 'authorized'
  | 'confirmed'
  | 'failed';

export interface WeroAccount {
  id: string;
  iban: string;
  bic: string;  // Bank code
  accountHolderName: string;
  accountHolderBirthDate: string;  // ISO 8601: YYYY-MM-DD
}

export interface WeroInitiateRequest {
  orderId: string;
  amount: number;  // Integer haléře
  returnUrl: string;
  successUrl?: string;
  theme?: string;
}

export interface WeroPayment {
  id: string;
  orderId: string;
  status: WeroPaymentStatus;
  externalId: string;  // Wero's payment ID
  amountHalire: number;
  ibanHash: string;  // AES-256 encrypted IBAN for compliance
  initiatedAt: string;
  authorizedAt?: string;
  confirmedAt?: string;
}

export interface WeroWebhook {
  eventId: string;
  paymentId: string;
  status: WeroPaymentStatus;
  errorCode?: string;
  errorMessage?: string;
}

export interface WeroInitiateResponse {
  redirectUrl: string;
  paymentId: string;
}

export interface WeroPaymentStatusResponse {
  id: string;
  status: WeroPaymentStatus;
  orderId: string;
  amountHalire: number;
  initiatedAt: string;
  confirmedAt?: string;
}

export interface WeroStatsResponse {
  promoterId: string;
  successfulPaymentsCount: number;
  totalVolumeHalire: number;
  averageAmountHalire: number;
}
