// =============================================================================
// SMS šablona — sestavení SMS zprávy pro vstupenku
// Max 160 znaků pro jeden SMS segment (GSM-7 charset)
// =============================================================================

// ---------------------------------------------------------------------------
// GSM-7 charset definice
// ---------------------------------------------------------------------------

/**
 * Základní GSM-7 znaky (jednobajtové, 160 znaků = 1 segment).
 * Rozšíření (escape sekvence) jako €, [, ], {, }, \, ^, ~, | se počítají jako 2 znaky.
 * Pro jednoduchost zde detekujeme pouze non-GSM7 znaky (Unicode = 70 znaků/segment).
 */
const GSM7_BASIC = new Set([
  '@', '£', '$', '¥', 'è', 'é', 'ù', 'ì', 'ò', 'Ç', '\n', 'Ø', 'ø', '\r', 'Å', 'å',
  'Δ', '_', 'Φ', 'Γ', 'Λ', 'Ω', 'Π', 'Ψ', 'Σ', 'Θ', 'Ξ', '\x1B', 'Æ', 'æ', 'ß', 'É',
  ' ', '!', '"', '#', '¤', '%', '&', "'", '(', ')', '*', '+', ',', '-', '.', '/',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ';', '<', '=', '>', '?',
  '¡', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
  'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'Ä', 'Ö', 'Ñ', 'Ü', '§',
  '¿', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o',
  'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'ä', 'ö', 'ñ', 'ü', 'à',
]);

/**
 * GSM-7 extended znaky (escape sekvence) — každý se počítá jako 2 znaky
 */
const GSM7_EXTENDED = new Set([
  '\f', '^', '{', '}', '\\', '[', '~', ']', '|', '€',
]);

// ---------------------------------------------------------------------------
// Parametry šablony
// ---------------------------------------------------------------------------

export interface SmsMessageParams {
  eventName: string;
  eventDate: string;   // Formátovaný datum, např. "15. dubna"
  eventTime: string;   // Formátovaný čas, např. "19:30"
  venueName: string;
  barcodeCode: string; // TK-2026-847291-X3
  shortCode: string;   // 8-char base62 kód
  baseUrl: string;     // Bez trailing slash, např. "tixly.cz"
}

// ---------------------------------------------------------------------------
// Maximální délky
// ---------------------------------------------------------------------------

const MAX_SMS_LENGTH = 160;
const TRUNCATED_VENUE_SUFFIX = '...';
const MAX_VENUE_NAME_TRUNCATED = 20;

// ---------------------------------------------------------------------------
// Pure funkce
// ---------------------------------------------------------------------------

/**
 * Sestaví SMS zprávu ze šablony.
 * Pokud by zpráva přesáhla 160 znaků, zkrátí venueName.
 *
 * Šablona:
 * ```
 * {eventName}
 * {eventDate} v {eventTime}, {venueName}
 *
 * Kód vstupu: {barcodeCode}
 *
 * Vstupenka: {baseUrl}/e/{shortCode}
 * ```
 *
 * @returns SMS zpráva, max 160 znaků
 */
export function buildSmsMessage(params: SmsMessageParams): string {
  const { eventName, eventDate, eventTime, barcodeCode, shortCode, baseUrl } = params;

  const buildMessage = (venueName: string): string =>
    `${eventName}\n${eventDate} v ${eventTime}, ${venueName}\n\nKód vstupu: ${barcodeCode}\n\nVstupenka: ${baseUrl}/e/${shortCode}`;

  const fullMessage = buildMessage(params.venueName);

  if (fullMessage.length <= MAX_SMS_LENGTH) {
    return fullMessage;
  }

  // Zpráva je příliš dlouhá — zkrátíme venueName
  const truncatedVenue =
    params.venueName.length > MAX_VENUE_NAME_TRUNCATED
      ? params.venueName.slice(0, MAX_VENUE_NAME_TRUNCATED) + TRUNCATED_VENUE_SUFFIX
      : params.venueName;

  const truncatedMessage = buildMessage(truncatedVenue);

  // Pokud je stále příliš dlouhá (extrémně dlouhý eventName), zkrátíme celkově
  if (truncatedMessage.length > MAX_SMS_LENGTH) {
    return truncatedMessage.slice(0, MAX_SMS_LENGTH);
  }

  return truncatedMessage;
}

// ---------------------------------------------------------------------------
// Post-purchase delivery SMS šablona
// ---------------------------------------------------------------------------

export interface SmsDeliveryTemplateInput {
  eventName: string;
  eventDate: string;     // již zformátované datum, např. "15. dubna 2026"
  shortCode: string;     // 8-char base62 kód
  baseUrl: string;       // host bez schématu, např. "tkr.cz"
}

const DELIVERY_ELLIPSIS = '...';

/**
 * Sestaví SMS pro doručení vstupenky ihned po koupi.
 *
 * Formát (max 160 znaků):
 *   "Vstupenka na {eventName} {eventDate}. Zobrazit: https://{baseUrl}/e/{shortCode}"
 *
 * Fallback při překročení limitu: postupně ořeže eventName a doplní elipsu,
 * dokud se celá zpráva nevejde do 160 znaků.
 */
export function buildSmsDeliveryMessage(input: SmsDeliveryTemplateInput): string {
  const { eventDate, shortCode, baseUrl } = input;

  const compose = (name: string): string =>
    `Vstupenka na ${name} ${eventDate}. Zobrazit: https://${baseUrl}/e/${shortCode}`;

  const full = compose(input.eventName);
  if (full.length <= MAX_SMS_LENGTH) {
    return full;
  }

  // Ořez eventName: binárně snižujeme délku, dokud se nevejde
  const overflow = full.length - MAX_SMS_LENGTH;
  // Potřebujeme odstranit alespoň `overflow + ellipsis.length` znaků z eventName
  let targetLen = input.eventName.length - overflow - DELIVERY_ELLIPSIS.length;
  if (targetLen < 1) targetLen = 1;

  let truncatedName = input.eventName.slice(0, targetLen) + DELIVERY_ELLIPSIS;
  let msg = compose(truncatedName);

  // Pojistka: pokud by stále přetékala (nečekané), iterativně ubírej
  while (msg.length > MAX_SMS_LENGTH && targetLen > 1) {
    targetLen -= 1;
    truncatedName = input.eventName.slice(0, targetLen) + DELIVERY_ELLIPSIS;
    msg = compose(truncatedName);
  }

  // Absolutní fallback — hrubý ořez
  if (msg.length > MAX_SMS_LENGTH) {
    return msg.slice(0, MAX_SMS_LENGTH);
  }

  return msg;
}

/**
 * Spočítá počet SMS segmentů pro danou zprávu.
 *
 * GSM-7 charset: 160 znaků = 1 segment, 153 znaků = 1 segment u multi-part
 * Unicode (UCS-2): 70 znaků = 1 segment, 67 znaků = 1 segment u multi-part
 *
 * Extended GSM-7 znaky (^, {, }, [, ], ~, |, \, €) se počítají jako 2 znaky.
 *
 * @returns Počet SMS segmentů (1 pro kratší zprávy, více pro delší)
 */
export function countSmsSegments(message: string): number {
  const isGsm7 = isGsm7Message(message);

  if (isGsm7) {
    const charCount = countGsm7Chars(message);
    if (charCount <= 160) return 1;
    // Multi-part: každý segment má 153 znaků (7 bajtů pro UDH header)
    return Math.ceil(charCount / 153);
  } else {
    // Unicode (UCS-2) kódování
    const charCount = message.length;
    if (charCount <= 70) return 1;
    // Multi-part Unicode: 67 znaků/segment
    return Math.ceil(charCount / 67);
  }
}

// ---------------------------------------------------------------------------
// Pomocné funkce
// ---------------------------------------------------------------------------

/**
 * Zkontroluje zda zpráva obsahuje pouze GSM-7 znaky (basic + extended).
 */
function isGsm7Message(message: string): boolean {
  for (const char of message) {
    if (!GSM7_BASIC.has(char) && !GSM7_EXTENDED.has(char)) {
      return false;
    }
  }
  return true;
}

/**
 * Spočítá efektivní délku GSM-7 zprávy (extended znaky = 2).
 */
function countGsm7Chars(message: string): number {
  let count = 0;
  for (const char of message) {
    count += GSM7_EXTENDED.has(char) ? 2 : 1;
  }
  return count;
}
