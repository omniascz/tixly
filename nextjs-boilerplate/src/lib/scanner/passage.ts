/**
 * Průchod branou — rozhodnutí, kterým směrem člověk jde.
 *
 * Obsluha u dveří nemá přepínat „vstup / výstup". Dívá se na příchozího,
 * ne do telefonu, a když zapomene přepnout, fronta stojí. Server přitom ví
 * z evidence, jestli je držitel vstupenky uvnitř, nebo venku — směr si tedy
 * určí sám a obsluze ho **ukáže**. Když se zobrazené nesejde se skutečností,
 * obsluha sken vezme zpět; nepípá znovu.
 *
 * Čistá logika bez databáze, aby šla otestovat na všech hraničních případech —
 * u dveří na ně není čas přijít pokusem.
 */

export type Direction = 'entry' | 'exit';
export type GateDirection = 'both' | 'entry' | 'exit';

export interface PassageState {
  /** Je držitel podle evidence uvnitř? */
  currentlyInside: boolean;
  /** Kolik vstupů už proběhlo (první vstup = 1). */
  scanCount: number;
  /** Kdy proběhl poslední nezrušený sken. */
  lastScanAt: Date | null;
  /** Směr posledního nezrušeného skenu. */
  lastDirection: Direction | null;
}

export interface PassageRules {
  /** Nejvyšší počet vstupů včetně prvního. */
  maxEntries: number;
  /** Prodleva mezi dvěma průchody v sekundách. 0 = vypnuto. */
  cooldownSeconds: number;
  /** Směr brány. 'both' = určí systém. */
  gateDirection: GateDirection;
}

export type PassageDecision =
  | {
      kind: 'admit';
      direction: 'entry';
      /** První vstup, nebo návrat po výstupu. */
      firstEntry: boolean;
      newScanCount: number;
      remainingEntries: number;
    }
  | { kind: 'release'; direction: 'exit' }
  | {
      /** Stejná vstupenka znovu v rámci prodlevy — nejspíš dvojí načtení kódu. */
      kind: 'duplicate';
      direction: Direction | null;
      secondsSinceLastScan: number;
    }
  | {
      kind: 'reject';
      reason: 'limit_reached' | 'already_inside' | 'not_inside' | 'cooldown';
      message: string;
    };

const round = (n: number): number => Math.round(n);

/** Kolik sekund uplynulo od posledního skenu. */
export function secondsSince(last: Date | null, now: Date): number | null {
  if (last === null) return null;
  return round((now.getTime() - last.getTime()) / 1000);
}

/**
 * Kterým směrem člověk jde. U brány s pevným směrem rozhoduje brána,
 * jinak se směr odvodí z toho, jestli je držitel uvnitř.
 */
export function resolveDirection(state: PassageState, gate: GateDirection): Direction {
  if (gate === 'entry') return 'entry';
  if (gate === 'exit') return 'exit';
  return state.currentlyInside ? 'exit' : 'entry';
}

export function decidePassage(
  state: PassageState,
  rules: PassageRules,
  now: Date,
): PassageDecision {
  const elapsed = secondsSince(state.lastScanAt, now);

  // Dvojí načtení téhož kódu. Řeší se dřív než cokoli jiného — jinak by
  // druhé načtení překlopilo stav a naúčtovalo další průchod.
  if (elapsed !== null && rules.cooldownSeconds > 0 && elapsed < rules.cooldownSeconds) {
    return {
      kind: 'duplicate',
      direction: state.lastDirection,
      secondsSinceLastScan: elapsed,
    };
  }

  const direction = resolveDirection(state, rules.gateDirection);

  if (direction === 'exit') {
    // Výstup u někoho, kdo podle evidence není uvnitř, dává smysl jen u brány
    // s pevným směrem — tam to znamená, že mu chybí vstupní sken.
    if (!state.currentlyInside) {
      return {
        kind: 'reject',
        reason: 'not_inside',
        message: 'Držitel není evidovaný uvnitř. Zkontroluj, jestli mu nechybí vstup.',
      };
    }
    return { kind: 'release', direction: 'exit' };
  }

  // Vstup u někoho, kdo už je uvnitř — nastane jen u brány s pevným směrem
  // (v automatickém režimu by vyšel výstup).
  if (state.currentlyInside) {
    return {
      kind: 'reject',
      reason: 'already_inside',
      message: 'Držitel je už evidovaný uvnitř.',
    };
  }

  if (state.scanCount >= rules.maxEntries) {
    return {
      kind: 'reject',
      reason: 'limit_reached',
      message: `Vyčerpaný počet vstupů (${rules.maxEntries}).`,
    };
  }

  const newScanCount = state.scanCount + 1;
  return {
    kind: 'admit',
    direction: 'entry',
    firstEntry: state.scanCount === 0,
    newScanCount,
    remainingEntries: rules.maxEntries - newScanCount,
  };
}

/**
 * Jak vypadá stav po vzetí posledního skenu zpět.
 *
 * Vstup se vrací tak, že držitel jde ven a počítadlo se sníží; výstup tak,
 * že se vrátí dovnitř a počítadlo zůstane — výstup ho nezvyšoval.
 */
export function undoScan(
  state: PassageState,
  undoneDirection: Direction,
): { currentlyInside: boolean; scanCount: number } {
  if (undoneDirection === 'entry') {
    return {
      currentlyInside: false,
      scanCount: Math.max(0, state.scanCount - 1),
    };
  }
  return { currentlyInside: true, scanCount: state.scanCount };
}

/** Popisek pro obsluhu — krátký, ať je čitelný na displeji v pohybu. */
export function decisionLabel(d: PassageDecision): string {
  switch (d.kind) {
    case 'admit':
      return d.firstEntry ? 'VSTUP' : `NÁVRAT (${d.newScanCount}.)`;
    case 'release':
      return 'ODCHOD';
    case 'duplicate':
      return 'JIŽ NAČTENO';
    case 'reject':
      return 'ZAMÍTNUTO';
  }
}

/**
 * Zvuková a hmatová odezva. Obsluha se dívá na příchozího, ne do telefonu —
 * směr musí poznat poslechem. Vzorec je v milisekundách pro `navigator.vibrate`.
 */
export function feedbackFor(d: PassageDecision): {
  tone: 'in' | 'out' | 'repeat' | 'deny';
  vibrate: number[];
} {
  switch (d.kind) {
    case 'admit':
      return { tone: 'in', vibrate: [100] };
    case 'release':
      return { tone: 'out', vibrate: [60, 50, 60] };
    case 'duplicate':
      return { tone: 'repeat', vibrate: [40] };
    case 'reject':
      return { tone: 'deny', vibrate: [200, 80, 200] };
  }
}
