// =============================================================================
// SERVICE: PDF vstupenka
// Orchestruje načtení dat z DB, TOTP generování a PDF sestavení.
// =============================================================================

import { generateTicketPdf } from '../lib/pdf-generator.js';
import type { PdfGenerationResult, PdfTicketData } from '../types/pdf-ticket.types.js';
import { PdfGenerationError } from '../types/pdf-ticket.types.js';

// ---------------------------------------------------------------------------
// Adaptérové rozhraní pro databázi
// ---------------------------------------------------------------------------

/**
 * Databázový adaptér — injektován pro testovatelnost.
 * Produkční implementace vykonává JOIN přes tickets, orders, events, venues, users.
 */
export interface PdfTicketDbAdapter {
  findTicketWithDetails(ticketId: string): Promise<{
    ticketId: string;
    orderId: string;
    ticketTypeName: string;
    zone: string | null;
    seatNumber: string | null;
    holderName: string;
    holderEmail: string;
    ownerId: string;
    barcodeCode: string;
    /** AES-256-GCM šifrované TOTP tajemství — service dešifruje přes CryptoAdapter */
    totpSecret: string;
    issuedAt: Date;
    eventName: string;
    eventDate: Date;
    eventVenue: string;
    eventAddress: string;
  } | null>;
}

// ---------------------------------------------------------------------------
// Adaptérové rozhraní pro kryptografii a TOTP
// ---------------------------------------------------------------------------

/**
 * Kryptografický adaptér — izoluje šifrovací logiku.
 * Produkční implementace:
 *   - decryptTotpSecret: AES-256-GCM dešifrování (klíč z env TOTP_ENCRYPTION_KEY)
 *   - generateTotpCode: HMAC-SHA1 TOTP dle RFC 6238, 8 číslic, okno 30s
 */
export interface CryptoAdapter {
  /** Dešifruje AES-256-GCM zašifrované TOTP tajemství */
  decryptTotpSecret(encryptedSecret: string): string;
  /** Vygeneruje aktuální 8-místný TOTP kód ze surového tajemství (base32) */
  generateTotpCode(secret: string): string;
}

// ---------------------------------------------------------------------------
// Typed error pro nenalezenou vstupenku
// ---------------------------------------------------------------------------

export class TicketNotFoundError extends Error {
  public readonly ticketId: string;

  constructor(ticketId: string) {
    super(`Vstupenka nenalezena: ${ticketId}`);
    this.name = 'TicketNotFoundError';
    this.ticketId = ticketId;
  }
}

export class TicketAccessDeniedError extends Error {
  public readonly ticketId: string;
  public readonly userId: string;

  constructor(ticketId: string, userId: string) {
    super(`Přístup odepřen k vstupence ${ticketId} pro uživatele ${userId}`);
    this.name = 'TicketAccessDeniedError';
    this.ticketId = ticketId;
    this.userId = userId;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Service pro generování PDF vstupenek on-demand.
 *
 * Každé volání generateForTicket():
 *   1. Načte vstupenku s kompletními JOIN daty z DB
 *   2. Ověří vlastnictví (MVP: vždy true, v produkci porovnat holder_id = userId)
 *   3. Dešifruje TOTP tajemství a vygeneruje aktuální TOTP kód
 *   4. Sestaví PdfTicketData a deleguje na generateTicketPdf()
 *   5. Vrátí PdfGenerationResult — PDF se neukládá nikde (on-demand only)
 */
export class PdfTicketService {
  /**
   * Vygeneruje PDF vstupenku pro daného uživatele.
   *
   * @param ticketId - UUID vstupenky
   * @param userId   - UUID přihlášeného uživatele (pro ownership check)
   * @param lang     - Jazyk PDF ('cs' nebo 'en')
   * @param db       - Databázový adaptér
   * @param crypto   - Kryptografický adaptér
   * @throws {TicketNotFoundError}    Vstupenka neexistuje
   * @throws {TicketAccessDeniedError} Uživatel nemá přístup (mimo MVP)
   * @throws {PdfGenerationError}     Generování PDF selhalo
   */
  async generateForTicket(
    ticketId: string,
    userId: string,
    lang: 'cs' | 'en',
    db: PdfTicketDbAdapter,
    crypto: CryptoAdapter,
  ): Promise<PdfGenerationResult> {
    // 1. Načtení vstupenky z DB
    const ticket = await db.findTicketWithDetails(ticketId);

    if (ticket === null) {
      throw new TicketNotFoundError(ticketId);
    }

    // 2. Ownership check — ověření že uživatel je aktuálním vlastníkem vstupenky
    if (ticket.ownerId !== userId) {
      throw new TicketAccessDeniedError(ticketId, userId);
    }

    // 3. Dešifrování TOTP tajemství + generování aktuálního kódu
    let totpCode: string;
    try {
      const rawSecret = crypto.decryptTotpSecret(ticket.totpSecret);
      totpCode = crypto.generateTotpCode(rawSecret);
    } catch (err) {
      throw new PdfGenerationError(
        `Nepodařilo se vygenerovat TOTP kód pro vstupenku ${ticketId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        'QR_GENERATION_FAILED',
        err,
      );
    }

    // 4. Sestavení PdfTicketData
    const pdfData: PdfTicketData = {
      eventName: ticket.eventName,
      eventDate: ticket.eventDate,
      eventVenue: ticket.eventVenue,
      eventAddress: ticket.eventAddress,
      ticketId: ticket.ticketId,
      orderId: ticket.orderId,
      ticketTypeName: ticket.ticketTypeName,
      zone: ticket.zone,
      seatNumber: ticket.seatNumber,
      holderName: ticket.holderName,
      holderEmail: ticket.holderEmail,
      totpCode,
      barcodeCode: ticket.barcodeCode,
      issuedAt: ticket.issuedAt,
      language: lang,
    };

    // 5. Generování PDF
    return generateTicketPdf(pdfData);
  }
}
