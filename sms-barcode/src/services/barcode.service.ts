import {
  generateBarcodeCode,
  generateShortCode,
} from '../lib/barcode-generator.js';
import {
  parseBarcodeCode,
  isBarcodeExpired,
  buildScanResult,
} from '../lib/barcode-validator.js';
import {
  BarcodeNotFoundError,
  BarcodeAlreadyScannedError,
  TicketExpiredError,
} from '../types/barcode.types.js';
import type { DbAdapter, BarcodeScanResult } from '../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------

const MAX_COLLISION_RETRIES = 3;

// ---------------------------------------------------------------------------
// Service funkce
// ---------------------------------------------------------------------------

/**
 * Přiřadí unikátní barcode_code a short_code k vstupenence.
 *
 * Idempotentní: pokud vstupenka již má barcode_code, vrátí existující.
 * Při kolizi v DB (UNIQUE constraint) zopakuje max 3×.
 *
 * @param ticketId - UUID vstupenky
 * @param db - Databázový adaptér
 * @returns barcode_code přiřazený k vstupence
 * @throws Error pokud se nepodaří přiřadit unikátní kód po MAX_COLLISION_RETRIES pokusech
 */
export async function assignBarcodeCode(
  ticketId: string,
  db: DbAdapter,
): Promise<string> {
  // Zkontroluj zda vstupenka již má barcode_code
  const existing = await db.getTicketById(ticketId);
  if (existing?.barcodeCode) {
    return existing.barcodeCode;
  }

  const year = new Date().getFullYear();

  for (let attempt = 1; attempt <= MAX_COLLISION_RETRIES; attempt++) {
    const barcodeCode = generateBarcodeCode(year);
    const shortCode = generateShortCode();

    // Rychlá kontrola kolize před DB operací (optional, snižuje zamíchané DB errory)
    const [barcodeExists, shortCodeExists] = await Promise.all([
      db.barcodeCodeExists(barcodeCode),
      db.shortCodeExists(shortCode),
    ]);

    if (barcodeExists || shortCodeExists) {
      // Kolize — zkusíme znovu
      if (attempt === MAX_COLLISION_RETRIES) {
        throw new Error(
          `Nepodařilo se přiřadit unikátní barcode_code po ${MAX_COLLISION_RETRIES} pokusech. ` +
            `ticketId: ${ticketId}`,
        );
      }
      continue;
    }

    // Atomický UPDATE: nastaví pouze pokud jsou NULL (ochrana před race condition)
    const assigned = await db.assignBarcodeCodes(ticketId, barcodeCode, shortCode);

    if (assigned) {
      return barcodeCode;
    }

    // assigned = false znamená race condition — jiný worker přiřadil kód dříve
    // Načteme co tam je
    const refreshed = await db.getTicketById(ticketId);
    if (refreshed?.barcodeCode) {
      return refreshed.barcodeCode;
    }

    if (attempt === MAX_COLLISION_RETRIES) {
      throw new Error(
        `Race condition při přiřazení barcode_code. ticketId: ${ticketId}`,
      );
    }
  }

  // TypeScript exhaustiveness — sem se nikdy nedostaneme
  throw new Error(`Unreachable: assignBarcodeCode ticketId: ${ticketId}`);
}

/**
 * Validuje skenování čárového kódu na turniketu.
 *
 * Flow:
 * 1. Parse + validace formátu
 * 2. SELECT vstupenka dle barcode_code
 * 3. Kontrola already_scanned
 * 4. Kontrola expirace
 * 5. Atomický UPDATE naskenování
 * 6. Return BarcodeScanResult
 *
 * @param rawCode - Surový vstup ze čtečky (může obsahovat whitespace, lowercase)
 * @param deviceId - ID gate zařízení (turniketu), pro audit log
 * @param db - Databázový adaptér
 * @throws {InvalidBarcodeFormatError} Neplatný formát kódu
 * @throws {BarcodeNotFoundError} Kód neexistuje v DB
 * @throws {BarcodeAlreadyScannedError} Vstupenka již byla naskenována
 * @throws {TicketExpiredError} Event skončil před více než 4 hodinami
 */
export async function validateScan(
  rawCode: string,
  deviceId: string,
  db: DbAdapter,
): Promise<BarcodeScanResult> {
  // 1. Parse a validace formátu — vyhodí InvalidBarcodeFormatError
  const cleanedCode = parseBarcodeCode(rawCode);

  // 2. Načteme vstupenku s kompletními JOIN daty
  const ticket = await db.getTicketWithEventByBarcode(cleanedCode);

  if (!ticket) {
    throw new BarcodeNotFoundError(cleanedCode);
  }

  // 3. Kontrola double-scan (anti-replay)
  if (ticket.barcodeScannedAt !== null) {
    throw new BarcodeAlreadyScannedError(
      ticket.barcodeScannedAt,
      ticket.barcodeScannedBy ?? 'unknown',
    );
  }

  // 4. Kontrola expirace (4h po skončení eventu)
  const eventEndAt = ticket.eventDateEnd ?? ticket.eventDateStart;
  if (isBarcodeExpired(eventEndAt)) {
    throw new TicketExpiredError(eventEndAt);
  }

  // 5. Atomický UPDATE — nastaví barcode_scanned_at a barcode_scanned_by
  //    WHERE barcode_scanned_at IS NULL zabrání double-scan race condition
  const scannedAt = new Date();
  const wasScanned = await db.markBarcodeScanned(ticket.id, deviceId, scannedAt);

  if (!wasScanned) {
    // Race condition: jiný turniket naskenoval ve stejný moment
    // Načteme aktuální stav a vrátíme AlreadyScanned error
    const refreshed = await db.getTicketWithEventByBarcode(cleanedCode);
    throw new BarcodeAlreadyScannedError(
      refreshed?.barcodeScannedAt ?? scannedAt,
      refreshed?.barcodeScannedBy ?? 'concurrent-scan',
    );
  }

  // 6. Sestavíme a vrátíme výsledek
  return buildScanResult(ticket, deviceId);
}

/**
 * Načte vstupenku dle short_code pro webovou stránku.
 *
 * @param shortCode - 8-znakový base62 kód z URL /e/{shortCode}
 * @param db - Databázový adaptér
 * @returns Vstupenka nebo null pokud neexistuje
 */
export async function getTicketByShortCode(
  shortCode: string,
  db: DbAdapter,
) {
  return db.getTicketByShortCode(shortCode);
}
