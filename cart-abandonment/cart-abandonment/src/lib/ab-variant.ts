// Deterministický A/B variant přiřazení — stejný userId vždy dostane stejný variant.
// Bez DB, bez cookies — čistá pure funkce.

import type { AbVariant } from '../types/cart.types';

/**
 * Přiřadí A/B variant deterministicky podle userId.
 * Používá FNV-1a hash → mod 2 → 'A' nebo 'B'.
 * Stejný userId = vždy stejný variant napříč session i zařízeními.
 */
export function assignAbVariant(userId: string): AbVariant {
  let hash = 2166136261;                        // FNV offset basis (32-bit)
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;             // FNV prime, unsigned 32-bit
  }
  return hash % 2 === 0 ? 'A' : 'B';
}
