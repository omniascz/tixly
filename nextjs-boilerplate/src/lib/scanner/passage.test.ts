import { describe, it, expect } from 'vitest';
import {
  decidePassage,
  resolveDirection,
  undoScan,
  decisionLabel,
  feedbackFor,
  secondsSince,
  type PassageState,
  type PassageRules,
} from './passage';

const NOW = new Date('2026-08-15T20:00:00Z');

const venku: PassageState = {
  currentlyInside: false,
  scanCount: 0,
  lastScanAt: null,
  lastDirection: null,
};

const uvnitr: PassageState = {
  currentlyInside: true,
  scanCount: 1,
  lastScanAt: new Date('2026-08-15T19:00:00Z'),
  lastDirection: 'entry',
};

const rules: PassageRules = { maxEntries: 3, cooldownSeconds: 10, gateDirection: 'both' };

describe('resolveDirection', () => {
  it('kdo je venku, jde dovnitř', () => {
    expect(resolveDirection(venku, 'both')).toBe('entry');
  });
  it('kdo je uvnitř, jde ven', () => {
    expect(resolveDirection(uvnitr, 'both')).toBe('exit');
  });
  it('brána s pevným směrem rozhoduje bez ohledu na stav', () => {
    expect(resolveDirection(uvnitr, 'entry')).toBe('entry');
    expect(resolveDirection(venku, 'exit')).toBe('exit');
  });
});

describe('decidePassage — běžný průchod', () => {
  it('první pípnutí je vždycky vstup', () => {
    const d = decidePassage(venku, rules, NOW);
    expect(d).toMatchObject({ kind: 'admit', direction: 'entry', firstEntry: true, newScanCount: 1 });
  });

  it('druhé pípnutí zevnitř je odchod', () => {
    const d = decidePassage(uvnitr, rules, NOW);
    expect(d).toEqual({ kind: 'release', direction: 'exit' });
  });

  it('návrat po odchodu je vstup a počítá se', () => {
    const poOdchodu: PassageState = {
      currentlyInside: false,
      scanCount: 1,
      lastScanAt: new Date('2026-08-15T19:30:00Z'),
      lastDirection: 'exit',
    };
    const d = decidePassage(poOdchodu, rules, NOW);
    expect(d).toMatchObject({ kind: 'admit', firstEntry: false, newScanCount: 2, remainingEntries: 1 });
  });

  it('vyčerpaný počet vstupů se odmítne se srozumitelnou hláškou', () => {
    const vycerpano: PassageState = {
      currentlyInside: false,
      scanCount: 3,
      lastScanAt: new Date('2026-08-15T19:30:00Z'),
      lastDirection: 'exit',
    };
    const d = decidePassage(vycerpano, rules, NOW);
    expect(d).toMatchObject({ kind: 'reject', reason: 'limit_reached' });
    if (d.kind === 'reject') expect(d.message).toContain('3');
  });
});

describe('decidePassage — dvojí načtení kódu', () => {
  it('stejná vstupenka do prodlevy se neprotočí, jen zopakuje výsledek', () => {
    const praveTed: PassageState = {
      currentlyInside: true,
      scanCount: 1,
      lastScanAt: new Date('2026-08-15T19:59:57Z'), // 3 s zpátky
      lastDirection: 'entry',
    };
    const d = decidePassage(praveTed, rules, NOW);
    expect(d).toMatchObject({ kind: 'duplicate', direction: 'entry', secondsSinceLastScan: 3 });
  });

  it('po uplynutí prodlevy už průchod projde', () => {
    const pozdeji: PassageState = {
      currentlyInside: true,
      scanCount: 1,
      lastScanAt: new Date('2026-08-15T19:59:45Z'), // 15 s zpátky
      lastDirection: 'entry',
    };
    const d = decidePassage(pozdeji, rules, NOW);
    expect(d.kind).toBe('release');
  });

  it('vypnutá prodleva nic neblokuje', () => {
    const praveTed: PassageState = {
      currentlyInside: true,
      scanCount: 1,
      lastScanAt: new Date('2026-08-15T19:59:59Z'),
      lastDirection: 'entry',
    };
    const d = decidePassage(praveTed, { ...rules, cooldownSeconds: 0 }, NOW);
    expect(d.kind).toBe('release');
  });

  it('dvojí načtení se řeší dřív než vyčerpaný limit', () => {
    // Jinak by druhé načtení u posledního vstupu hlásilo „vyčerpáno“.
    const naLimitu: PassageState = {
      currentlyInside: true,
      scanCount: 3,
      lastScanAt: new Date('2026-08-15T19:59:58Z'),
      lastDirection: 'entry',
    };
    const d = decidePassage(naLimitu, rules, NOW);
    expect(d.kind).toBe('duplicate');
  });
});

describe('decidePassage — brána s pevným směrem', () => {
  it('na vstupní bráně se ten, kdo je uvnitř, odmítne', () => {
    const d = decidePassage(uvnitr, { ...rules, gateDirection: 'entry' }, NOW);
    expect(d).toMatchObject({ kind: 'reject', reason: 'already_inside' });
  });

  it('na výstupní bráně se ten, kdo není uvnitř, odmítne', () => {
    const d = decidePassage(venku, { ...rules, gateDirection: 'exit' }, NOW);
    expect(d).toMatchObject({ kind: 'reject', reason: 'not_inside' });
  });

  it('výstupní brána pustí ven toho, kdo je uvnitř', () => {
    const d = decidePassage(uvnitr, { ...rules, gateDirection: 'exit' }, NOW);
    expect(d.kind).toBe('release');
  });
});

describe('undoScan', () => {
  it('vzetí vstupu zpět vrátí držitele ven a sníží počítadlo', () => {
    expect(undoScan({ ...uvnitr, scanCount: 2 }, 'entry')).toEqual({
      currentlyInside: false,
      scanCount: 1,
    });
  });

  it('vzetí odchodu zpět vrátí držitele dovnitř a počítadlo nechá', () => {
    expect(undoScan({ ...venku, scanCount: 2 }, 'exit')).toEqual({
      currentlyInside: true,
      scanCount: 2,
    });
  });

  it('počítadlo nikdy nespadne pod nulu', () => {
    expect(undoScan({ ...uvnitr, scanCount: 0 }, 'entry').scanCount).toBe(0);
  });

  it('vstup a jeho vzetí zpět vrátí přesně původní stav', () => {
    const pred = decidePassage(venku, rules, NOW);
    expect(pred.kind).toBe('admit');
    const po = undoScan({ ...venku, currentlyInside: true, scanCount: 1 }, 'entry');
    expect(po).toEqual({ currentlyInside: false, scanCount: 0 });
  });
});

describe('popisky a odezva', () => {
  it('první vstup a návrat se v popisku liší', () => {
    expect(decisionLabel(decidePassage(venku, rules, NOW))).toBe('VSTUP');
    const poOdchodu: PassageState = {
      currentlyInside: false,
      scanCount: 1,
      lastScanAt: new Date('2026-08-15T19:00:00Z'),
      lastDirection: 'exit',
    };
    expect(decisionLabel(decidePassage(poOdchodu, rules, NOW))).toContain('NÁVRAT');
  });

  it('vstup a odchod mají rozdílný tón — obsluha se nedívá do telefonu', () => {
    const vstup = feedbackFor(decidePassage(venku, rules, NOW));
    const odchod = feedbackFor(decidePassage(uvnitr, rules, NOW));
    expect(vstup.tone).toBe('in');
    expect(odchod.tone).toBe('out');
    expect(vstup.tone).not.toBe(odchod.tone);
    expect(vstup.vibrate).not.toEqual(odchod.vibrate);
  });

  it('zamítnutí má vlastní, výrazně jinou odezvu', () => {
    const zamitnuto = feedbackFor({ kind: 'reject', reason: 'limit_reached', message: 'x' });
    expect(zamitnuto.tone).toBe('deny');
  });
});

describe('secondsSince', () => {
  it('bez předchozího skenu vrací null', () => {
    expect(secondsSince(null, NOW)).toBeNull();
  });
  it('počítá v celých sekundách', () => {
    expect(secondsSince(new Date('2026-08-15T19:59:30Z'), NOW)).toBe(30);
  });
});
