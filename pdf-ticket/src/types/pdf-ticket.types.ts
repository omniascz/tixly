// =============================================================================
// TYPY: PDF vstupenka
// =============================================================================

// ---------------------------------------------------------------------------
// Vstupní data pro generování PDF
// ---------------------------------------------------------------------------

/**
 * Všechna data potřebná pro vygenerování PDF vstupenky.
 * Caller (PdfTicketService) sestaví tento objekt před voláním generateTicketPdf().
 */
export interface PdfTicketData {
  // Akce
  eventName: string;
  eventDate: Date;
  eventVenue: string;
  eventAddress: string;

  // Vstupenka
  /** UUID vstupenky — zobrazit zkráceně: první 8 znaků */
  ticketId: string;
  /** UUID objednávky — zobrazit zkráceně: první 8 znaků */
  orderId: string;
  ticketTypeName: string;
  zone: string | null;
  seatNumber: string | null;

  // Držitel
  holderName: string;
  holderEmail: string;

  // Kódy
  /** Aktuální 8-místný TOTP kód — generuje caller před sestavením dat */
  totpCode: string;
  /** Čárový kód ve formátu TK-2026-XXXXXX-XX */
  barcodeCode: string;

  // Meta
  issuedAt: Date;
  language: 'cs' | 'en';
}

// ---------------------------------------------------------------------------
// Výstup generování
// ---------------------------------------------------------------------------

/**
 * Výsledek úspěšného vygenerování PDF vstupenky.
 */
export interface PdfGenerationResult {
  /** Vygenerované PDF jako binární pole */
  pdfBytes: Uint8Array;
  /** Doporučený název souboru, např. "vstupenka-eventname-abc12345.pdf" */
  filename: string;
  /** Velikost PDF v bajtech */
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export type PdfGenerationErrorCode =
  | 'QR_GENERATION_FAILED'
  | 'BARCODE_GENERATION_FAILED'
  | 'PDF_ASSEMBLY_FAILED'
  | 'INVALID_INPUT';

export class PdfGenerationError extends Error {
  public readonly code: PdfGenerationErrorCode;
  public readonly cause?: unknown;

  constructor(
    message: string,
    code: PdfGenerationErrorCode,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'PdfGenerationError';
    this.code = code;
    this.cause = cause;
  }
}
