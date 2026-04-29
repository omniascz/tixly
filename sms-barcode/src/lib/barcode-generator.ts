import { randomInt, randomBytes } from 'node:crypto';
import bwipjs from 'bwip-js';
import type { BarcodeOptions } from '../types/barcode.types.js';

// ---------------------------------------------------------------------------
// Konstanty
// ---------------------------------------------------------------------------

const BASE62_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BARCODE_SUFFIX_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BARCODE_REGEX = /^TK-\d{4}-\d{6}-[A-Z0-9]{2}$/;

// ---------------------------------------------------------------------------
// Generátory
// ---------------------------------------------------------------------------

/**
 * Generuje unikátní barcode_code ve formátu TK-{year}-{6 číslic}-{2 velká alfanum}.
 * Příklad: "TK-2026-847291-X3"
 *
 * Délka: 16 znaků — Code 128 kompatibilní (jen ASCII printable).
 * Entropie sufixu: 36^2 = 1296 kombinací (kombinace s číselnými 6 = 10^6 × 1296 ≈ 1,3 mld).
 *
 * @param year - Rok eventu (typicky aktuální rok)
 */
export function generateBarcodeCode(year: number): string {
  // 6 náhodných číslic: každá 0-9
  const digits = Array.from({ length: 6 }, () => randomInt(0, 10)).join('');

  // 2 náhodné velké alfanumerické znaky (A-Z, 0-9)
  const suffixBytes = randomBytes(2);
  const suffix = Array.from(suffixBytes)
    .map((b) => BARCODE_SUFFIX_CHARS[b % BARCODE_SUFFIX_CHARS.length])
    .join('');

  return `TK-${year}-${digits}-${suffix}`;
}

/**
 * Generuje krátký 8-znakový base62 kód pro URL odkaz na vstupenku.
 * Příklad: "aB3xK9qR"
 *
 * Entropie: 62^8 ≈ 218 miliard kombinací.
 */
export function generateShortCode(): string {
  // Generujeme 8 bytů a mapujeme na base62 — stejný princip jako referral kódy
  const bytes = randomBytes(8);
  return Array.from(bytes)
    .map((b) => BASE62_CHARS[b % BASE62_CHARS.length])
    .join('');
}

/**
 * Validuje formát barcode_code.
 * Přijímá pouze kódy ve formátu TK-{4 číslice}-{6 číslic}-{2 velká alfanum}.
 */
export function isValidBarcodeCode(code: string): boolean {
  return BARCODE_REGEX.test(code);
}

/**
 * Generuje Code 128 čárový kód jako PNG Buffer.
 * Vhodné pro e-mail přílohu nebo server-side generování obrázku.
 *
 * @param code - Barcode kód (validovaný)
 * @param options - Volitelné nastavení vzhledu
 */
export async function generateBarcodePng(
  code: string,
  options: BarcodeOptions = {},
): Promise<Buffer> {
  const {
    scale = 3,
    height = 10,
    includeText = true,
    textSize = 12,
  } = options;

  const buffer = await bwipjs.toBuffer({
    bcid: 'code128',
    text: code,
    scale,
    height,
    includetext: includeText,
    textsize: textSize,
    backgroundcolor: 'ffffff',
    barcolor: '000000',
  });

  return buffer;
}

/**
 * Generuje Code 128 čárový kód jako inline SVG string.
 * Vhodné pro webové zobrazení — žádné externí requesty, funguje offline.
 *
 * SVG je generován na serveru a vložen přímo do HTML jako inline element.
 *
 * @param code - Barcode kód (validovaný)
 * @param options - Volitelné nastavení vzhledu
 */
export async function generateBarcodeSvg(
  code: string,
  options: BarcodeOptions = {},
): Promise<string> {
  const {
    scale = 3,
    height = 10,
    includeText = true,
    textSize = 12,
  } = options;

  const svg = await bwipjs.toSVG({
    bcid: 'code128',
    text: code,
    scale,
    height,
    includetext: includeText,
    textsize: textSize,
    backgroundcolor: 'ffffff',
    barcolor: '000000',
  });

  return svg;
}
