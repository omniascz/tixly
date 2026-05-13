import type { BarcodeTicket, BarcodeScanResult } from '../types/barcode.types.js';
import { InvalidBarcodeFormatError } from '../types/barcode.types.js';
import { isValidBarcodeCode } from './barcode-generator.js';

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------

/**
 * Čárový kód je platný do N hodin po skončení eventu.
 * Pokrývá pozdní příchody, technické problémy na vstupu atp.
 */
const BARCODE_GRACE_PERIOD_HOURS = 4;

// ---------------------------------------------------------------------------
// Pure validační funkce (bez DB závislosti)
// ---------------------------------------------------------------------------

/**
 * Parsuje a čistí surový vstup ze čtečky čárových kódů.
 *
 * Čtečky mohou přidat whitespace, non-printable znaky nebo lowercase.
 * Tato funkce normalizuje vstup před validací.
 *
 * @throws {InvalidBarcodeFormatError} Pokud kód po čištění stále není platný
 */
export function parseBarcodeCode(raw: string): string {
  // Trim whitespace (čtečky občas pošlou \r\n na konci)
  let cleaned = raw.trim();

  // Uppercase — čtečky někdy mění case
  cleaned = cleaned.toUpperCase();

  // Strip non-printable ASCII znaky (< 0x20 nebo >= 0x7F)
  cleaned = cleaned.replace(/[^\x20-\x7E]/g, '');

  // Strip zbylé whitespace uvnitř kódu (pro robustnost)
  cleaned = cleaned.replace(/\s+/g, '');

  if (!isValidBarcodeCode(cleaned)) {
    throw new InvalidBarcodeFormatError(raw);
  }

  return cleaned;
}

/**
 * Zkontroluje zda čárový kód ještě platí.
 *
 * Platnost: od vydání vstupenky do BARCODE_GRACE_PERIOD_HOURS hodin po skončení eventu.
 * Pokud event nemá datum konce (date_end IS NULL), použijeme datum začátku + 4h.
 *
 * @param eventEndAt - Datum konce eventu (date_end nebo date_start jako fallback)
 * @param scanAt - Datum skenování (default = NOW())
 */
export function isBarcodeExpired(eventEndAt: Date, scanAt?: Date): boolean {
  const checkAt = scanAt ?? new Date();
  const expiresAt = new Date(
    eventEndAt.getTime() + BARCODE_GRACE_PERIOD_HOURS * 60 * 60 * 1000,
  );
  return checkAt > expiresAt;
}

/**
 * Sestaví BarcodeScanResult pro úspěšné skenování.
 * Tato pure funkce neprovádí DB zápis — ten je zodpovědností service.
 *
 * @param ticket - Vstupenka z DB (po ověření všech podmínek)
 * @param deviceId - ID gate zařízení
 */
export function buildScanResult(
  ticket: BarcodeTicket,
  deviceId: string,
): BarcodeScanResult {
  void deviceId; // deviceId je použit v service pro DB zápis; zde jen pro DX

  return {
    valid: true,
    ticketId: ticket.id,
    holderName: ticket.holderName,
    eventName: ticket.eventName,
    eventDate: ticket.eventDateStart,
    seatInfo: ticket.seatInfo,
    zone: ticket.zone,
  };
}
