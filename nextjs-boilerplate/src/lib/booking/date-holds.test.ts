import { describe, it, expect } from 'vitest';
import {
  nextOptionRank,
  reorderAfterRelease,
  canConfirm,
  isExpired,
  type DateHold,
} from './date-holds';

const hold = (id: string, rank: number, status: DateHold['status'] = 'held'): DateHold => ({
  id,
  optionRank: rank,
  status,
});

describe('nextOptionRank', () => {
  it('první zájemce dostane první opci', () => {
    expect(nextOptionRank([])).toBe(1);
  });

  it('další zájemci se řadí za sebe', () => {
    expect(nextOptionRank([hold('a', 1)])).toBe(2);
    expect(nextOptionRank([hold('a', 1), hold('b', 2)])).toBe(3);
  });

  it('uvolněné pořadí se zaplní', () => {
    expect(nextOptionRank([hold('a', 1), hold('c', 3)])).toBe(2);
  });

  it('zrušené a propadlé opce místo neblokují', () => {
    expect(nextOptionRank([hold('a', 1, 'released'), hold('b', 2, 'expired')])).toBe(1);
  });
});

describe('reorderAfterRelease', () => {
  it('po propadnutí první se druhá stane první', () => {
    const changes = reorderAfterRelease([
      hold('a', 1, 'expired'),
      hold('b', 2),
      hold('c', 3),
    ]);
    expect(changes).toEqual([
      { id: 'b', fromRank: 2, toRank: 1, becamePrimary: true },
      { id: 'c', fromRank: 3, toRank: 2, becamePrimary: false },
    ]);
  });

  it('nepřeskakuje — třetí se nestane první před druhou', () => {
    const changes = reorderAfterRelease([hold('a', 1, 'released'), hold('c', 3), hold('b', 2)]);
    const first = changes.find((c) => c.toRank === 1);
    expect(first?.id).toBe('b');
  });

  it('když se nic nemění, nevrací nic', () => {
    expect(reorderAfterRelease([hold('a', 1), hold('b', 2)])).toEqual([]);
  });

  it('prázdný seznam nespadne', () => {
    expect(reorderAfterRelease([])).toEqual([]);
  });
});

describe('canConfirm', () => {
  it('první opce smí potvrdit', () => {
    const holds = [hold('a', 1), hold('b', 2)];
    expect(canConfirm(holds[0], holds).ok).toBe(true);
  });

  it('druhá opce potvrdit nesmí a dozví se proč', () => {
    const holds = [hold('a', 1), hold('b', 2)];
    const r = canConfirm(holds[1], holds);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2. v pořadí');
  });

  it('už potvrzený termín nejde potvrdit znovu', () => {
    const holds = [hold('a', 1, 'confirmed'), hold('b', 2)];
    expect(canConfirm(holds[1], holds).ok).toBe(false);
  });

  it('neaktivní opce potvrdit nejde', () => {
    const holds = [hold('a', 1, 'released')];
    expect(canConfirm(holds[0], holds).ok).toBe(false);
  });
});

describe('isExpired', () => {
  const now = new Date('2026-08-14T12:00:00Z');

  it('opce bez lhůty nepropadá', () => {
    expect(isExpired(null, now)).toBe(false);
  });

  it('lhůta v minulosti znamená propadnutí', () => {
    expect(isExpired(new Date('2026-08-13T12:00:00Z'), now)).toBe(true);
  });

  it('lhůta v budoucnu drží', () => {
    expect(isExpired(new Date('2026-08-20T12:00:00Z'), now)).toBe(false);
  });
});
