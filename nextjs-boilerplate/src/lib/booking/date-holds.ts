/**
 * Opce na termín — pravidla posunu pořadí.
 *
 * Čistá logika bez databáze, aby se dala otestovat bez běžícího Postgresu.
 * Pravidla vycházejí z toho, jak to chodí v praxi:
 *
 *   • Pořadí je souvislá řada od jedničky. Když první opce propadne nebo ji
 *     držitel pustí, všechny za ní se posunou o jedna — druhá se stane první
 *     a získává právo potvrdit.
 *   • Posun se **neposkakuje**: kdo byl třetí, nikdy se nestane prvním dřív
 *     než ten, kdo byl druhý.
 *   • Potvrzením termínu ostatní opce padají. Sál je obsazený, nemá smysl
 *     držet lidem naději.
 */

export interface DateHold {
  id: string;
  optionRank: number;
  status: 'held' | 'confirmed' | 'released' | 'expired';
}

export interface RankChange {
  id: string;
  fromRank: number;
  toRank: number;
  /** Posunul se na první místo — držiteli se má ozvat. */
  becamePrimary: boolean;
}

/** Další volné pořadí pro nový hold na daný termín. */
export function nextOptionRank(existing: DateHold[]): number {
  const taken = new Set(existing.filter((h) => h.status === 'held').map((h) => h.optionRank));
  let rank = 1;
  while (taken.has(rank)) rank += 1;
  return rank;
}

/**
 * Přepočítá pořadí poté, co některá opce přestala platit.
 * Vrací jen ty, kterým se pořadí mění — aby se nezapisovalo zbytečně.
 */
export function reorderAfterRelease(holds: DateHold[]): RankChange[] {
  const active = holds
    .filter((h) => h.status === 'held')
    .sort((a, b) => a.optionRank - b.optionRank);

  const changes: RankChange[] = [];
  active.forEach((h, idx) => {
    const target = idx + 1;
    if (h.optionRank !== target) {
      changes.push({
        id: h.id,
        fromRank: h.optionRank,
        toRank: target,
        becamePrimary: target === 1,
      });
    }
  });
  return changes;
}

/** Smí tahle opce termín potvrdit? Potvrzuje jen první v pořadí. */
export function canConfirm(hold: DateHold, allHolds: DateHold[]): { ok: boolean; reason?: string } {
  if (hold.status !== 'held') {
    return { ok: false, reason: 'Opce už není aktivní.' };
  }
  const confirmed = allHolds.find((h) => h.status === 'confirmed');
  if (confirmed) {
    return { ok: false, reason: 'Termín už je potvrzený někým jiným.' };
  }
  const first = allHolds
    .filter((h) => h.status === 'held')
    .sort((a, b) => a.optionRank - b.optionRank)[0];
  if (first && first.id !== hold.id) {
    return {
      ok: false,
      reason: `Termín drží první opce. Tahle je ${hold.optionRank}. v pořadí.`,
    };
  }
  return { ok: true };
}

/** Propadla lhůta? Bez lhůty opce drží, dokud ji někdo nepustí. */
export function isExpired(expiresAt: Date | null, now: Date): boolean {
  if (expiresAt === null) return false;
  return expiresAt.getTime() < now.getTime();
}
