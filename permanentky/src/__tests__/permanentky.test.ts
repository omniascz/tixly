// =============================================================================
// Permanentky — unit tests (Vitest)
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activatePackage,
  consumeCredit,
  expireOldPackages,
  getClientBalance,
  purchasePackage,
  refundCredit,
} from '../services/permanentky.service.js';
import { seedDefaultTemplates } from '../services/package-template.service.js';
import { PermanentkyError } from '../lib/permanentky-errors.js';
import type { ServiceDeps } from '../lib/service-container.js';

// -----------------------------------------------------------------------------
// Mock DB factory
// -----------------------------------------------------------------------------

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makeDeps(
  handler: (call: QueryCall) => { rows: unknown[]; rowCount?: number },
): { deps: ServiceDeps; calls: QueryCall[]; kafkaEmits: Array<{ topic: string; payload: unknown }> } {
  const calls: QueryCall[] = [];
  const kafkaEmits: Array<{ topic: string; payload: unknown }> = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const call = { sql, params };
    calls.push(call);
    const res = handler(call);
    return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
  });

  const db = {
    query,
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      return fn({ query });
    }),
  } as unknown as ServiceDeps['db'];

  const kafka = {
    emit: vi.fn(async (topic: string, payload: Record<string, unknown>) => {
      kafkaEmits.push({ topic, payload });
    }),
  };

  return { deps: { db, kafka }, calls, kafkaEmits };
}

const TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';
const CLIENT_ID = '00000000-0000-0000-0000-000000000010';
const OTHER_CLIENT = '00000000-0000-0000-0000-000000000011';
const PACKAGE_ID = '00000000-0000-0000-0000-000000000100';
const PROMOTER_ID = '00000000-0000-0000-0000-000000000500';

function templateRow() {
  return {
    id: TEMPLATE_ID,
    promoter_id: PROMOTER_ID,
    total_credits: 10,
    validity_days: 30,
    price_halire: 690000,
    is_active: true,
  };
}

function packageRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: PACKAGE_ID,
    client_id: CLIENT_ID,
    template_id: TEMPLATE_ID,
    promoter_id: PROMOTER_ID,
    total_credits: 10,
    remaining_credits: 10,
    status: 'active',
    price_paid_halire: 690000,
    payment_ref: 'pi_123',
    purchased_at: now,
    valid_from: now,
    valid_until: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
    created_at: now,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// purchasePackage
// -----------------------------------------------------------------------------

describe('purchasePackage', () => {
  it('creates pending_payment row when no paymentRef', async () => {
    const { deps, kafkaEmits } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.templates')) {
        return { rows: [templateRow()] };
      }
      if (call.sql.includes('INSERT INTO permanentky.client_packages')) {
        expect(call.params[4]).toBe('pending_payment');
        return { rows: [packageRow({ status: 'pending_payment', payment_ref: null })] };
      }
      return { rows: [] };
    });

    const pkg = await purchasePackage(
      { templateId: TEMPLATE_ID, clientId: CLIENT_ID },
      deps,
    );
    expect(pkg.status).toBe('pending_payment');
    expect(kafkaEmits[0].topic).toBe('permanentka.purchased');
  });

  it('computes validUntil as validFrom + validityDays', async () => {
    const validFrom = new Date('2026-01-01T00:00:00Z');
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.templates')) {
        return { rows: [templateRow()] };
      }
      if (call.sql.includes('INSERT INTO permanentky.client_packages')) {
        const vf = call.params[7] as Date;
        const vu = call.params[8] as Date;
        expect(vf.toISOString()).toBe(validFrom.toISOString());
        expect(vu.toISOString()).toBe('2026-01-31T00:00:00.000Z');
        return { rows: [packageRow({ valid_from: vf, valid_until: vu })] };
      }
      return { rows: [] };
    });

    await purchasePackage(
      { templateId: TEMPLATE_ID, clientId: CLIENT_ID, paymentRef: 'pi', validFrom },
      deps,
    );
  });

  it('throws TEMPLATE_NOT_FOUND if missing', async () => {
    const { deps } = makeDeps(() => ({ rows: [] }));
    await expect(
      purchasePackage({ templateId: TEMPLATE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'TEMPLATE_NOT_FOUND' });
  });
});

// -----------------------------------------------------------------------------
// activatePackage
// -----------------------------------------------------------------------------

describe('activatePackage', () => {
  it('transitions pending -> active', async () => {
    let current = packageRow({ status: 'pending_payment', payment_ref: null });
    const { deps, kafkaEmits } = makeDeps((call) => {
      if (call.sql.startsWith('SELECT *')) return { rows: [current] };
      if (call.sql.startsWith('UPDATE permanentky.client_packages')) {
        current = { ...current, status: 'active', payment_ref: 'pi_new' };
        return { rows: [current] };
      }
      return { rows: [] };
    });

    const pkg = await activatePackage(PACKAGE_ID, 'pi_new', deps);
    expect(pkg.status).toBe('active');
    expect(pkg.paymentRef).toBe('pi_new');
    expect(kafkaEmits[0].topic).toBe('permanentka.activated');
  });

  it('throws if already active', async () => {
    const { deps } = makeDeps(() => ({ rows: [packageRow({ status: 'active' })] }));
    await expect(activatePackage(PACKAGE_ID, 'pi', deps)).rejects.toMatchObject({
      code: 'PACKAGE_NOT_ACTIVE',
    });
  });
});

// -----------------------------------------------------------------------------
// consumeCredit
// -----------------------------------------------------------------------------

describe('consumeCredit', () => {
  it('decrements remaining credits', async () => {
    let pkg = packageRow({ remaining_credits: 5 });
    const { deps, kafkaEmits } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      if (call.sql.includes('SELECT 1 FROM permanentky.usages')) return { rows: [] };
      if (call.sql.includes('INSERT INTO permanentky.usages')) {
        return {
          rows: [
            {
              id: 'u1',
              package_id: PACKAGE_ID,
              client_id: CLIENT_ID,
              reservation_id: null,
              consumed_at: new Date(),
              is_refund: false,
            },
          ],
        };
      }
      if (call.sql.includes('UPDATE permanentky.client_packages')) {
        pkg = { ...pkg, remaining_credits: call.params[1] as number, status: call.params[2] as string };
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps);
    expect(res.remainingCredits).toBe(4);
    expect(kafkaEmits.some((e) => e.topic === 'permanentka.credit_consumed')).toBe(true);
  });

  it('sets status=depleted when last credit consumed', async () => {
    const pkg = packageRow({ remaining_credits: 1 });
    let updateStatus: string | undefined;
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      if (call.sql.includes('INSERT INTO permanentky.usages')) {
        return { rows: [{ id: 'u1', package_id: PACKAGE_ID, client_id: CLIENT_ID, reservation_id: null, consumed_at: new Date(), is_refund: false }] };
      }
      if (call.sql.includes('UPDATE permanentky.client_packages')) {
        updateStatus = call.params[2] as string;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps);
    expect(res.remainingCredits).toBe(0);
    expect(updateStatus).toBe('depleted');
  });

  it('throws PACKAGE_EXPIRED on expired package', async () => {
    const pkg = packageRow({ valid_until: new Date(Date.now() - 1000) });
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      return { rows: [] };
    });
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_EXPIRED' });
  });

  it('throws DUPLICATE_USAGE on repeat reservationId', async () => {
    const pkg = packageRow();
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      if (call.sql.includes('SELECT 1 FROM permanentky.usages')) return { rows: [{ '?column?': 1 }] };
      return { rows: [] };
    });
    await expect(
      consumeCredit(
        {
          packageId: PACKAGE_ID,
          clientId: CLIENT_ID,
          reservationId: '00000000-0000-0000-0000-000000000999',
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'DUPLICATE_USAGE' });
  });

  it('throws PACKAGE_NOT_OWNED when clientId differs', async () => {
    const pkg = packageRow();
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      return { rows: [] };
    });
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: OTHER_CLIENT }, deps),
    ).rejects.toBeInstanceOf(PermanentkyError);
  });
});

// -----------------------------------------------------------------------------
// refundCredit
// -----------------------------------------------------------------------------

describe('refundCredit', () => {
  it('increments remaining credits and restores depleted -> active', async () => {
    const origUsage = {
      id: 'u1',
      package_id: PACKAGE_ID,
      client_id: CLIENT_ID,
      reservation_id: null,
      consumed_at: new Date(),
      is_refund: false,
    };
    const pkg = packageRow({ remaining_credits: 0, status: 'depleted' });
    let updatedStatus: string | undefined;
    let updatedRemaining: number | undefined;

    const { deps, kafkaEmits } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.usages WHERE id')) return { rows: [origUsage] };
      if (call.sql.includes('FROM permanentky.client_packages WHERE id')) return { rows: [pkg] };
      if (call.sql.includes('INSERT INTO permanentky.usages')) {
        return {
          rows: [
            { ...origUsage, id: 'refund1', is_refund: true },
          ],
        };
      }
      if (call.sql.includes('UPDATE permanentky.client_packages')) {
        updatedRemaining = call.params[1] as number;
        updatedStatus = call.params[2] as string;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await refundCredit('u1', 'client cancelled', 'admin-1', deps);
    expect(res.remainingCredits).toBe(1);
    expect(updatedRemaining).toBe(1);
    expect(updatedStatus).toBe('active');
    expect(kafkaEmits.some((e) => e.topic === 'permanentka.credit_refunded')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// getClientBalance
// -----------------------------------------------------------------------------

describe('getClientBalance', () => {
  it('sums credits across multiple active packages', async () => {
    const now = new Date();
    const p1 = packageRow({
      id: 'p1',
      remaining_credits: 3,
      valid_until: new Date(now.getTime() + 10 * 24 * 3600 * 1000),
    });
    const p2 = packageRow({
      id: 'p2',
      remaining_credits: 7,
      valid_until: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
    });
    const { deps } = makeDeps(() => ({ rows: [p1, p2] }));
    const bal = await getClientBalance(CLIENT_ID, deps);
    expect(bal.totalRemainingCredits).toBe(10);
    expect(bal.activePackages).toHaveLength(2);
    expect(bal.nextExpiresAt?.getTime()).toBe(p1.valid_until.getTime());
  });

  it('returns empty balance when no active packages', async () => {
    const { deps } = makeDeps(() => ({ rows: [] }));
    const bal = await getClientBalance(CLIENT_ID, deps);
    expect(bal.totalRemainingCredits).toBe(0);
    expect(bal.nextExpiresAt).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// expireOldPackages
// -----------------------------------------------------------------------------

describe('expireOldPackages', () => {
  it('returns count of expired packages', async () => {
    const { deps } = makeDeps(() => ({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
    const res = await expireOldPackages(deps);
    expect(res.expired).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// seedDefaultTemplates
// -----------------------------------------------------------------------------

describe('seedDefaultTemplates', () => {
  it('creates 2 templates with PulseUp prices (300000 / 690000 halíře)', async () => {
    const created: Array<Record<string, unknown>> = [];
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('INSERT INTO permanentky.templates')) {
        const row = {
          id: `tpl-${created.length + 1}`,
          promoter_id: call.params[0],
          name: call.params[1],
          type: call.params[2],
          total_credits: call.params[3],
          validity_days: call.params[4],
          price_halire: call.params[5],
          description: call.params[6],
          is_active: true,
          created_at: new Date(),
        };
        created.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    });

    const res = await seedDefaultTemplates(PROMOTER_ID, deps);
    expect(res.created).toHaveLength(2);
    const prices = res.created.map((t) => t.priceHalire).sort((a, b) => a - b);
    expect(prices).toEqual([300000, 690000]);
    const credits = res.created.map((t) => t.totalCredits).sort((a, b) => a - b);
    expect(credits).toEqual([4, 10]);
  });
});

// =============================================================================
// consumeCredit — PACKAGE_DEPLETED on 0 remaining credits
// =============================================================================

describe('consumeCredit — depleted package', () => {
  it('throws PACKAGE_DEPLETED when remaining_credits is 0', async () => {
    const pkg = packageRow({ remaining_credits: 0, status: 'active' });
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      return { rows: [] };
    });
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_DEPLETED' });
  });
});

// =============================================================================
// consumeCredit — PACKAGE_NOT_ACTIVE for non-active statuses
// =============================================================================

describe('consumeCredit — non-active statuses', () => {
  it('throws PACKAGE_NOT_ACTIVE for pending_payment package', async () => {
    const pkg = packageRow({ status: 'pending_payment' });
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      return { rows: [] };
    });
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_ACTIVE' });
  });

  it('throws PACKAGE_NOT_ACTIVE for refunded package', async () => {
    const pkg = packageRow({ status: 'refunded' });
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FOR UPDATE')) return { rows: [pkg] };
      return { rows: [] };
    });
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_ACTIVE' });
  });
});

// =============================================================================
// purchasePackage — active immediately when paymentRef provided
// =============================================================================

describe('purchasePackage — with paymentRef', () => {
  it('creates active row when paymentRef is provided', async () => {
    const { deps, kafkaEmits } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.templates')) {
        return { rows: [templateRow()] };
      }
      if (call.sql.includes('INSERT INTO permanentky.client_packages')) {
        expect(call.params[4]).toBe('active');
        return { rows: [packageRow({ status: 'active', payment_ref: 'pi_prepaid' })] };
      }
      return { rows: [] };
    });

    const pkg = await purchasePackage(
      { templateId: TEMPLATE_ID, clientId: CLIENT_ID, paymentRef: 'pi_prepaid' },
      deps,
    );
    expect(pkg.status).toBe('active');
    expect(pkg.paymentRef).toBe('pi_prepaid');
    expect(kafkaEmits[0].topic).toBe('permanentka.purchased');
  });

  it('throws TEMPLATE_INACTIVE for inactive template', async () => {
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.templates')) {
        return { rows: [{ ...templateRow(), is_active: false }] };
      }
      return { rows: [] };
    });
    await expect(
      purchasePackage({ templateId: TEMPLATE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'TEMPLATE_INACTIVE' });
  });
});

// =============================================================================
// activatePackage — not found
// =============================================================================

describe('activatePackage — edge cases', () => {
  it('throws PACKAGE_NOT_FOUND if package does not exist', async () => {
    const { deps } = makeDeps(() => ({ rows: [] }));
    await expect(
      activatePackage('nonexistent', 'pi', deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
  });
});

// =============================================================================
// refundCredit — cannot refund a refund row
// =============================================================================

describe('refundCredit — edge cases', () => {
  it('throws DUPLICATE_USAGE when trying to refund a refund row', async () => {
    const refundRow = {
      id: 'u-refund',
      package_id: PACKAGE_ID,
      client_id: CLIENT_ID,
      reservation_id: null,
      consumed_at: new Date(),
      is_refund: true,
    };
    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.usages WHERE id')) return { rows: [refundRow] };
      return { rows: [] };
    });
    await expect(
      refundCredit('u-refund', 'oops', 'admin-1', deps),
    ).rejects.toMatchObject({ code: 'DUPLICATE_USAGE' });
  });

  it('throws PACKAGE_NOT_FOUND when usage does not exist', async () => {
    const { deps } = makeDeps(() => ({ rows: [] }));
    await expect(
      refundCredit('nonexistent', 'reason', 'admin-1', deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_NOT_FOUND' });
  });

  it('refund on active package keeps status active', async () => {
    const origUsage = {
      id: 'u2',
      package_id: PACKAGE_ID,
      client_id: CLIENT_ID,
      reservation_id: null,
      consumed_at: new Date(),
      is_refund: false,
    };
    const pkg = packageRow({ remaining_credits: 5, status: 'active' });
    let updatedStatus: string | undefined;

    const { deps } = makeDeps((call) => {
      if (call.sql.includes('FROM permanentky.usages WHERE id')) return { rows: [origUsage] };
      if (call.sql.includes('FROM permanentky.client_packages WHERE id')) return { rows: [pkg] };
      if (call.sql.includes('INSERT INTO permanentky.usages')) {
        return { rows: [{ ...origUsage, id: 'refund2', is_refund: true }] };
      }
      if (call.sql.includes('UPDATE permanentky.client_packages')) {
        updatedStatus = call.params[2] as string;
        return { rows: [] };
      }
      return { rows: [] };
    });

    const res = await refundCredit('u2', 'mistake', 'admin-1', deps);
    expect(res.remainingCredits).toBe(6);
    expect(updatedStatus).toBe('active');
  });
});

// =============================================================================
// getClientBalance — single package scenario
// =============================================================================

describe('getClientBalance — single package', () => {
  it('returns balance with single active package', async () => {
    const now = new Date();
    const p1 = packageRow({
      id: 'p1',
      remaining_credits: 8,
      valid_until: new Date(now.getTime() + 15 * 24 * 3600 * 1000),
    });
    const { deps } = makeDeps(() => ({ rows: [p1] }));
    const bal = await getClientBalance(CLIENT_ID, deps);
    expect(bal.totalRemainingCredits).toBe(8);
    expect(bal.activePackages).toHaveLength(1);
    expect(bal.nextExpiresAt).not.toBeNull();
  });
});

// =============================================================================
// expireOldPackages — no packages to expire
// =============================================================================

describe('expireOldPackages — empty', () => {
  it('returns expired=0 when no packages match', async () => {
    const { deps } = makeDeps(() => ({ rows: [] }));
    const res = await expireOldPackages(deps);
    expect(res.expired).toBe(0);
  });
});

// =============================================================================
// consumeCredit — souběžnost / FOR UPDATE guard
//
// Audit vyžadoval test, který ověří, že SELECT FOR UPDATE je správně
// uzamčen uvnitř db.transaction — aby nedocházelo k "lost update" race condition.
// =============================================================================

describe('consumeCredit — FOR UPDATE inside db.transaction (concurrency guard)', () => {
  it('SELECT FOR UPDATE je volán uvnitř db.transaction (ne jako bare query)', async () => {
    const pkg = packageRow({ remaining_credits: 3 });
    const queriesInsideTx: string[] = [];
    let inTransaction = false;

    const queryFn = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (inTransaction) queriesInsideTx.push(sql);

      if (sql.includes('FOR UPDATE')) return { rows: [pkg], rowCount: 1 };
      if (sql.includes('INSERT INTO permanentky.usages')) {
        return {
          rows: [{ id: 'u1', package_id: PACKAGE_ID, client_id: CLIENT_ID, reservation_id: null, consumed_at: new Date(), is_refund: false }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const txFn = vi.fn(async (fn: (tx: unknown) => unknown) => {
      inTransaction = true;
      const result = await fn({ query: queryFn });
      inTransaction = false;
      return result;
    });

    const db = { query: queryFn, transaction: txFn } as unknown as ServiceDeps['db'];
    const kafka = { emit: vi.fn().mockResolvedValue(undefined) };

    await consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, { db, kafka });

    // Ověření: transaction byl zavolán
    expect(txFn).toHaveBeenCalledTimes(1);
    // Ověření: FOR UPDATE query byl vydán UVNITŘ transakce
    expect(queriesInsideTx.some((sql) => sql.includes('FOR UPDATE'))).toBe(true);
  });

  it('simulace souběhu (lost update): druhý volající vidí 0 kreditů po commitu prvního → PACKAGE_DEPLETED', async () => {
    // Bez FOR UPDATE: oba volající by přečetli remaining_credits=1 a oba by uspěli → credits = -1
    // S FOR UPDATE (reálná DB): druhý volající čeká na lock a po commitu prvního vidí 0 → PACKAGE_DEPLETED
    // Tento test simuluje stav "po commitu prvního" — druhý SELECT FOR UPDATE vrátí 0 kreditů.

    let callCount = 0;

    const queryFn = vi.fn(async (sql: string, _params: unknown[] = []) => {
      if (sql.includes('FOR UPDATE')) {
        callCount++;
        // Caller 1: vidí 1 kredit (před commitem prvního)
        // Caller 2: vidí 0 kreditů (po commitu prvního — jak by to viděl s FOR UPDATE v reálné DB)
        const remaining = callCount === 1 ? 1 : 0;
        return { rows: [packageRow({ remaining_credits: remaining })], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO permanentky.usages')) {
        return {
          rows: [{ id: `u${callCount}`, package_id: PACKAGE_ID, client_id: CLIENT_ID, reservation_id: null, consumed_at: new Date(), is_refund: false }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const db = {
      query: queryFn,
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ query: queryFn })),
    } as unknown as ServiceDeps['db'];
    const kafka = { emit: vi.fn().mockResolvedValue(undefined) };
    const deps = { db, kafka };

    // První volající: získá kredit, remaining = 0
    const first = await consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps);
    expect(first.remainingCredits).toBe(0);

    // Druhý volající: vidí 0 kreditů (za předpokladu správného FOR UPDATE lockingu v DB)
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID }, deps),
    ).rejects.toMatchObject({ code: 'PACKAGE_DEPLETED' });
  });

  it('idempotence přes reservationId: stejná rezervace dvakrát → DUPLICATE_USAGE (ochrana při retries)', async () => {
    // Klient pošle dvě identická volání (network retry nebo double-click).
    // FOR UPDATE + DUPLICATE_USAGE check zajistí, že kredit se odečte jen jednou.
    const pkg = packageRow({ remaining_credits: 5 });
    const RESERVATION_ID = '00000000-0000-0000-0000-000000000999';

    let usageExists = false;

    const queryFn = vi.fn(async (sql: string, _params: unknown[] = []) => {
      if (sql.includes('FOR UPDATE')) return { rows: [pkg], rowCount: 1 };
      if (sql.includes('SELECT 1 FROM permanentky.usages')) {
        // Druhé volání: usage already exists
        return { rows: usageExists ? [{ '?column?': 1 }] : [], rowCount: usageExists ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO permanentky.usages')) {
        usageExists = true;
        return {
          rows: [{ id: 'u1', package_id: PACKAGE_ID, client_id: CLIENT_ID, reservation_id: RESERVATION_ID, consumed_at: new Date(), is_refund: false }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const db = {
      query: queryFn,
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ query: queryFn })),
    } as unknown as ServiceDeps['db'];
    const kafka = { emit: vi.fn().mockResolvedValue(undefined) };
    const deps = { db, kafka };

    // První volání: úspěch
    await consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID, reservationId: RESERVATION_ID }, deps);

    // Druhé volání (retry): DUPLICATE_USAGE — kredit se neodečte podruhé
    await expect(
      consumeCredit({ packageId: PACKAGE_ID, clientId: CLIENT_ID, reservationId: RESERVATION_ID }, deps),
    ).rejects.toMatchObject({ code: 'DUPLICATE_USAGE' });

    // Kafka emit byl zavolán jen jednou (jen při prvním úspěšném consume)
    expect(kafka.emit).toHaveBeenCalledTimes(1);
  });
});

// Quieten unused import
beforeEach(() => {
  void PermanentkyError;
});
