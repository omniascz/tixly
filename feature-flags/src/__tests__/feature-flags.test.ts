import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FlagStore, FeatureFlag } from '../lib/types.js';
import { hashToPercentage, evaluateFlag } from '../lib/flag-evaluator.js';
import { createCachedStore } from '../lib/cache.js';
import {
  upsertFlag,
  disableFlag,
  isEnabled,
  getEnabledFlags,
  listFlags,
  deleteFlag,
  setRolloutPercentage,
} from '../services/feature-flags.service.js';

function createMemoryStore(): FlagStore {
  const store = new Map<string, FeatureFlag>();
  return {
    getFlag: vi.fn().mockImplementation(async (key) => store.get(key) ?? null),
    setFlag: vi.fn().mockImplementation(async (flag) => { store.set(flag.key, flag); }),
    deleteFlag: vi.fn().mockImplementation(async (key) => { store.delete(key); }),
    listFlags: vi.fn().mockImplementation(async () => Array.from(store.values())),
  };
}

describe('upsertFlag', () => {
  it('1. vytvoří nový flag se status="disabled" jako default', async () => {
    const store = createMemoryStore();
    const flag = await upsertFlag('new-flag', {}, store);
    expect(flag.key).toBe('new-flag');
    expect(flag.status).toBe('disabled');
    expect(flag.createdAt).toBeTruthy();
    expect(flag.updatedAt).toBeTruthy();
  });

  it('2. vytvoří flag s status="enabled"', async () => {
    const store = createMemoryStore();
    const flag = await upsertFlag('my-flag', { status: 'enabled' }, store);
    expect(flag.status).toBe('enabled');
  });

  it('3. aktualizuje status existujícího flagu (updatedAt se změní, createdAt ne)', async () => {
    const store = createMemoryStore();
    const original = await upsertFlag('flag-x', { status: 'disabled' }, store);
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));
    const updated = await upsertFlag('flag-x', { status: 'enabled' }, store);
    expect(updated.status).toBe('enabled');
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.updatedAt).not.toBe(original.updatedAt);
  });

  it('4. zachová existující values které nejsou v data', async () => {
    const store = createMemoryStore();
    await upsertFlag('flag-y', { status: 'enabled', description: 'hello', enabledTenants: ['t1'] }, store);
    const updated = await upsertFlag('flag-y', { status: 'disabled' }, store);
    expect(updated.description).toBe('hello');
    expect(updated.enabledTenants).toEqual(['t1']);
  });
});

describe('isEnabled', () => {
  it('5. enabled flag → true', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'enabled' }, store);
    expect(await isEnabled('feat', {}, store)).toBe(true);
  });

  it('6. disabled flag → false', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'disabled' }, store);
    expect(await isEnabled('feat', {}, store)).toBe(false);
  });

  it('7. neexistující flag → false (safe default)', async () => {
    const store = createMemoryStore();
    expect(await isEnabled('nonexistent', {}, store)).toBe(false);
  });

  it('8. gradual 100% → true pro jakýkoliv tenant', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'gradual', rolloutPercentage: 100 }, store);
    expect(await isEnabled('feat', { tenantId: 'any-tenant' }, store)).toBe(true);
    expect(await isEnabled('feat', { tenantId: 'another' }, store)).toBe(true);
  });

  it('9. gradual 0% → false pro jakýkoliv tenant', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'gradual', rolloutPercentage: 0 }, store);
    expect(await isEnabled('feat', { tenantId: 'any-tenant' }, store)).toBe(false);
    expect(await isEnabled('feat', { tenantId: 'another' }, store)).toBe(false);
  });

  it('10. enabledTenants — tenant v seznamu → true i když status="disabled"', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'disabled', enabledTenants: ['special-tenant'] }, store);
    expect(await isEnabled('feat', { tenantId: 'special-tenant' }, store)).toBe(true);
  });

  it('11. disabledTenants — tenant v seznamu → false i když status="enabled"', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'enabled', disabledTenants: ['blocked-tenant'] }, store);
    expect(await isEnabled('feat', { tenantId: 'blocked-tenant' }, store)).toBe(false);
  });

  it('12. disabledTenants má prioritu nad enabledTenants (tenant v obou → false)', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', {
      status: 'enabled',
      enabledTenants: ['t1'],
      disabledTenants: ['t1'],
    }, store);
    expect(await isEnabled('feat', { tenantId: 't1' }, store)).toBe(false);
  });
});

describe('getEnabledFlags', () => {
  it('13. vrátí mapu pro více flagů', async () => {
    const store = createMemoryStore();
    await upsertFlag('flag-a', { status: 'enabled' }, store);
    await upsertFlag('flag-b', { status: 'disabled' }, store);
    const result = await getEnabledFlags(['flag-a', 'flag-b', 'flag-c'], {}, store);
    expect(result['flag-a']).toBe(true);
    expect(result['flag-b']).toBe(false);
    expect(result['flag-c']).toBe(false);
  });
});

describe('listFlags', () => {
  it('14. vrátí všechny flagy', async () => {
    const store = createMemoryStore();
    await upsertFlag('f1', { status: 'enabled' }, store);
    await upsertFlag('f2', { status: 'disabled' }, store);
    const flags = await listFlags(store);
    expect(flags.length).toBe(2);
    expect(flags.map((f) => f.key)).toContain('f1');
    expect(flags.map((f) => f.key)).toContain('f2');
  });
});

describe('deleteFlag', () => {
  it('15. odstraní flag', async () => {
    const store = createMemoryStore();
    await upsertFlag('to-delete', { status: 'enabled' }, store);
    await deleteFlag('to-delete', store);
    expect(await isEnabled('to-delete', {}, store)).toBe(false);
    const flags = await listFlags(store);
    expect(flags.find((f) => f.key === 'to-delete')).toBeUndefined();
  });
});

describe('setRolloutPercentage', () => {
  it('16. nastaví status="gradual" a percentage', async () => {
    const store = createMemoryStore();
    const flag = await setRolloutPercentage('feat', 42, store);
    expect(flag.status).toBe('gradual');
    expect(flag.rolloutPercentage).toBe(42);
  });

  it('17. hodí error pro percentage < 0', async () => {
    const store = createMemoryStore();
    await expect(setRolloutPercentage('feat', -1, store)).rejects.toThrow('Percentage must be 0-100');
  });

  it('18. hodí error pro percentage > 100', async () => {
    const store = createMemoryStore();
    await expect(setRolloutPercentage('feat', 101, store)).rejects.toThrow('Percentage must be 0-100');
  });
});

describe('disableFlag', () => {
  it('19. nastaví status="disabled"', async () => {
    const store = createMemoryStore();
    await upsertFlag('feat', { status: 'enabled' }, store);
    await disableFlag('feat', store);
    expect(await isEnabled('feat', {}, store)).toBe(false);
    const flag = await store.getFlag('feat');
    expect(flag?.status).toBe('disabled');
  });
});

describe('hashToPercentage', () => {
  it('20. deterministický (stejný input → stejný output)', () => {
    const r1 = hashToPercentage('tenant-abc', 'my-flag');
    const r2 = hashToPercentage('tenant-abc', 'my-flag');
    expect(r1).toBe(r2);
  });

  it('21. vrátí číslo 0-99', () => {
    const values = [
      hashToPercentage('t1', 'flag1'),
      hashToPercentage('t2', 'flag2'),
      hashToPercentage('', 'flag'),
      hashToPercentage('tenant', ''),
    ];
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(99);
    }
  });

  it('22. různé inputs → různé výsledky (aspoň 3 různé)', () => {
    const results = new Set([
      hashToPercentage('tenant-1', 'feature-x'),
      hashToPercentage('tenant-2', 'feature-x'),
      hashToPercentage('tenant-3', 'feature-x'),
      hashToPercentage('tenant-4', 'feature-x'),
      hashToPercentage('tenant-5', 'feature-x'),
    ]);
    expect(results.size).toBeGreaterThanOrEqual(3);
  });
});

describe('evaluateFlag', () => {
  it('23. gradual 50% — konzistentní pro stejný tenantId', () => {
    const flag: FeatureFlag = {
      key: 'gradual-flag',
      status: 'gradual',
      rolloutPercentage: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const ctx = { tenantId: 'stable-tenant' };
    const result1 = evaluateFlag(flag, ctx);
    const result2 = evaluateFlag(flag, ctx);
    const result3 = evaluateFlag(flag, ctx);
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });
});

describe('createCachedStore', () => {
  it('24. druhé volání getFlag vrátí z cache (store.getFlag zavoláno jen 1x)', async () => {
    const store = createMemoryStore();
    await upsertFlag('cached-flag', { status: 'enabled' }, store);

    // Reset mock call count after setup
    vi.clearAllMocks();

    const cached = createCachedStore(store, 10000);
    await cached.getFlag('cached-flag');
    await cached.getFlag('cached-flag');
    await cached.getFlag('cached-flag');

    expect(store.getFlag).toHaveBeenCalledTimes(1);
  });
});
