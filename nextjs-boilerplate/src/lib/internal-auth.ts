/**
 * Ověření interních volání mezi našimi vlastními endpointy.
 *
 * Proč to má být na jednom místě: v srpnu 2026 se ukázalo, že
 * `/api/internal/royalties/accrue` porovnával heslo proti proměnné
 * `INTERNAL_API_TOKEN`, zatímco zbytek platformy i nasazovací dokumentace
 * používají `INTERNAL_SERVICE_TOKEN`. Endpoint proto odpovídal 401 na každé
 * volání — a protože se volá stylem „pošli a zapomeň", nikdo si toho nevšiml.
 * Podíly umělců se kvůli tomu nikdy nezačaly načítat.
 *
 * Pravidla:
 *   • Přijímáme obě jména proměnné; `INTERNAL_API_TOKEN` má přednost.
 *   • Když není nastavené ani jedno, odmítáme **všechno**. Prázdné heslo
 *     nesmí být klíč, který otevírá dveře.
 *   • Porovnání je časově nezávislé, aby se heslo nedalo uhodnout po znacích.
 */

import { timingSafeEqual } from 'crypto';

/** Heslo očekávané od volajícího, nebo null když není nakonfigurované. */
export function getInternalToken(): string | null {
  const t = process.env.INTERNAL_API_TOKEN ?? process.env.INTERNAL_SERVICE_TOKEN ?? '';
  return t.length > 0 ? t : null;
}

/** Časově nezávislé porovnání dvou hesel. */
export function safeTokenEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type InternalAuthResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing' | 'mismatch' };

/**
 * Ověří hlavičku `x-internal-token`. Vrací důvod odmítnutí, aby ho volající
 * mohl zalogovat — tichá 401 je přesně to, co tenhle problém způsobilo.
 */
export function verifyInternalToken(headerValue: string | null): InternalAuthResult {
  const expected = getInternalToken();
  if (expected === null) return { ok: false, reason: 'not_configured' };
  if (!headerValue) return { ok: false, reason: 'missing' };
  if (!safeTokenEqual(headerValue, expected)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

/** Hlavičky pro odchozí interní volání. Prázdné heslo se neposílá. */
export function internalAuthHeaders(): Record<string, string> {
  const t = getInternalToken();
  return t === null ? {} : { 'x-internal-token': t };
}
