// Base62 generátor pro affiliate kódy.
// 8 znaků z 62-znakové abecedy = 62^8 = ~218 miliard unikátních kódů.
// Dostatečné pro platformu s tisíci affiliaty.

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;
const CODE_REGEX = /^[A-Za-z0-9]{8}$/;

/**
 * Vygeneruje náhodný 8-znakový base62 affiliate kód.
 * Používá crypto.getRandomValues pro kryptograficky bezpečnou náhodnost.
 */
export function generateAffiliateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join('');
}

/**
 * Ověří formát affiliate kódu — 8 base62 znaků.
 */
export function isValidAffiliateCode(code: string): boolean {
  return CODE_REGEX.test(code);
}

/**
 * Vypočítá komisi v haléřích.
 * commissionRateBps: basis points (500 = 5.00 %)
 * orderAmount: haléře
 */
export function calculateCommission(orderAmount: number, commissionRateBps: number): number {
  return Math.floor((orderAmount * commissionRateBps) / 10000);
}
