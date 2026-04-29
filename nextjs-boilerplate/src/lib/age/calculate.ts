/**
 * Calendar-correct age computation v UTC.
 * Použito v `/api/checkout` pro 18+ gate (#199).
 *
 * Edge cases:
 *  - Invalid date string → NaN
 *  - Future birthDate → záporné věk (caller by měl reject)
 *  - Birthday today → věk = exactly N years (≥ N pass)
 *  - Birthday tomorrow → ještě N-1 let
 */
export function calculateAgeYears(birthIso: string, atDate: Date): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthIso)) return NaN;
  const birth = new Date(birthIso + 'T00:00:00Z');
  if (isNaN(birth.getTime())) return NaN;
  let age = atDate.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    atDate.getUTCMonth() < birth.getUTCMonth() ||
    (atDate.getUTCMonth() === birth.getUTCMonth() &&
      atDate.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
