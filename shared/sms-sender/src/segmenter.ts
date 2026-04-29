/**
 * SMS segment counter — determines how many SMS segments a message occupies.
 *
 * GSM-7 encoding: 160 chars single / 153 per segment (multipart)
 * UCS-2 encoding: 70 chars single / 67 per segment (multipart)
 *
 * Extended GSM-7 characters (^, {, }, [, ], ~, |, \, €) count as 2 characters.
 */

// GSM-7 basic alphabet (3GPP 23.038)
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split(''),
);

// GSM-7 extension characters (each counts as 2 characters)
const GSM7_EXT = new Set('^{}\\[~]|€'.split(''));

/**
 * Check if the entire text can be encoded as GSM-7.
 */
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.has(ch) && !GSM7_EXT.has(ch)) {
      return false;
    }
  }
  return true;
}

/**
 * Calculate the GSM-7 encoded length (extension chars count as 2).
 */
export function gsm7Length(text: string): number {
  let len = 0;
  for (const ch of text) {
    len += GSM7_EXT.has(ch) ? 2 : 1;
  }
  return len;
}

/**
 * Returns the number of SMS segments the text occupies.
 *
 * - GSM-7: 160 single / 153 per segment (multipart)
 * - UCS-2 (Unicode): 70 single / 67 per segment (multipart)
 */
export function countSegments(text: string): number {
  if (text.length === 0) return 0;

  if (isGsm7(text)) {
    const len = gsm7Length(text);
    if (len <= 160) return 1;
    return Math.ceil(len / 153);
  }

  // Unicode mode (diacritics, emoji, CJK, etc.)
  const len = [...text].length; // count code points, not UTF-16 units
  if (len <= 70) return 1;
  return Math.ceil(len / 67);
}

/**
 * Check if text fits within a maximum number of segments (default 10).
 */
export function isWithinLimit(text: string, maxSegments = 10): boolean {
  return countSegments(text) <= maxSegments;
}

/**
 * Returns true if the text needs UCS-2 encoding (contains non-GSM-7 characters).
 */
export function needsUnicode(text: string): boolean {
  return !isGsm7(text);
}
