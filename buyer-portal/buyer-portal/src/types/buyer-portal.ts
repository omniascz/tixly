// =============================================================================
// Veřejné DTO typy pro zákaznický portál kupce vstupenky
// =============================================================================

export type BuyerTicketStatus = 'valid' | 'used' | 'cancelled' | 'refunded';
export type BuyerOrderStatus = 'pending' | 'paid' | 'refunded' | 'cancelled';

export interface BuyerTicketSummary {
  ticketId: string;
  orderId: string;
  eventId: string;
  eventName: string;
  /** ISO 8601 datetime */
  eventDate: string;
  venueName: string;
  ticketTypeName: string;
  /** Např. "Sekce A / Řada 3 / Místo 12". Null pokud jsou všechny složky prázdné. */
  seatInfo: string | null;
  status: BuyerTicketStatus;
  holderName: string;
  /** ISO 8601 datetime */
  issuedAt: string;
}

export interface BuyerTicketDetail extends BuyerTicketSummary {
  barcodeCode: string;
  shortCode: string;
  /** Aktuální 8-místný TOTP kód — generován per-request */
  totpCode: string;
  /** ISO 8601 — kdy končí aktuální 30s okno TOTP */
  totpValidUntil: string;
  /** Odkaz na stažení PDF vstupenky */
  pdfDownloadUrl: string;
}

export interface BuyerOrderSummary {
  orderId: string;
  /** ISO 8601 datetime */
  createdAt: string;
  status: BuyerOrderStatus;
  /** Celková částka v halířích (INTEGER) */
  totalAmountHalire: number;
  ticketCount: number;
  /** Název první akce v objednávce, nebo "multiple" při více akcích */
  eventName: string;
  /** ISO 8601 datetime nebo null */
  paidAt: string | null;
}

export interface BuyerOrderDetail extends BuyerOrderSummary {
  tickets: BuyerTicketSummary[];
  subtotalHalire: number;
  feesHalire: number;
  refundedAmountHalire: number | null;
}
