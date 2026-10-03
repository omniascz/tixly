/**
 * Porovnávání a rozsahy čísel sedadel.
 *
 * Čísla míst jsou v databázi text, protože sály používají i „12A" nebo „B7".
 * Naivní textové porovnání ale řadí „10" před „2", takže rozsah „od 2 do 10"
 * by sebral jen dvě místa. Tady je jedno pravidlo pro celou platformu:
 * když jsou obě čísla číselná, porovnávej číselně; jinak abecedně (česky).
 */

/** Záporné číslo když a < b, nula při shodě, kladné když a > b. */
export function seatNumCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && a.trim() !== '' && b.trim() !== '') {
    return na - nb;
  }
  return a.localeCompare(b, 'cs');
}

/**
 * Spadá číslo místa do rozsahu? Oba kraje jsou včetně;
 * nezadaná hranice znamená „bez omezení".
 */
export function inSeatRange(num: string, from?: string, to?: string): boolean {
  if (from !== undefined && from !== '' && seatNumCompare(num, from) < 0) return false;
  if (to !== undefined && to !== '' && seatNumCompare(num, to) > 0) return false;
  return true;
}
