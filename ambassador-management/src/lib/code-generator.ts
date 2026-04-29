// Ambassador kód generátor
// Znakové sady záměrně vynechává O, 0, I, 1 pro čitelnost na tištěných vstupenecích.
// 8 znaků × 32 symbolů = 32^8 ≈ 1 bilion unikátních kódů.

/** Znaky pro ambassador kódy — velká písmena + číslice bez O, 0, I, 1 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

/**
 * Vygeneruje kryptograficky bezpečný 8-znakový ambassador kód.
 * Používá crypto.getRandomValues — funguje jak v Node.js (≥ 19) tak v Edge runtime.
 */
export function generateAmbassadorCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => CHARSET[b % CHARSET.length])
    .join('');
}

/**
 * Ověří, zda řetězec odpovídá formátu ambassador kódu.
 */
export function isValidAmbassadorCode(code: string): boolean {
  return CODE_REGEX.test(code);
}
