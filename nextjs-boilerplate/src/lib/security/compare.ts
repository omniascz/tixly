import { timingSafeEqual } from 'crypto';

/**
 * Konstantně-časové porovnání dvou stringů (kódy, podpisy, secrety).
 *
 * `a === b` u tajných hodnot leakuje přes čas, kde se liší první znak → boční
 * kanál. timingSafeEqual potřebuje stejně dlouhé buffery; rozdílná délka se
 * krátí na false (délka není tajná u fixních kódů). Pro neprázdné secrety OK.
 */
export function safeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
