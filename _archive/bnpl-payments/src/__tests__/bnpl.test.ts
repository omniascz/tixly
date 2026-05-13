import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initiateBnplPayment,
  getBnplPayment,
  listBnplPaymentsForUser,
  markAsDelivered,
  cancelBnplPayment,
  syncBnplStatus,
  getOverduePayments,
  markAsOverdue,
} from '../services/bnpl.service';
import {
  BnplError,
  type BnplPayment,
  type BnplPaymentStatus,
  type DbAdapter,
  type InitiateBnplInput,
  type KlarnaAdapter,
  type ServiceDeps,
  type TwistoAdapter,
} from '../types/bnpl.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DbSeed {
  queryResults?: unknown[][];
}

function makeDb(seed: DbSeed = {}) {
  const queryResults = seed.queryResults ?? [];
  let idx = 0;
  const db = {
    query: vi.fn().mockImplementation(async () => {
      const r = queryResults[idx++];
      return r ?? [];
    }),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: (d: DbAdapter) => Promise<unknown>) => fn(db as unknown as DbAdapter)),
  };
  return db;
}

function makeTwisto(overrides: Partial<TwistoAdapter> = {}): TwistoAdapter {
  return {
    createPayment: vi
      .fn()
      .mockResolvedValue({ paymentId: 'twisto-pay-1', approved: true }),
    cancelPayment: vi.fn().mockResolvedValue(undefined),
    getPaymentStatus: vi
      .fn()
      .mockResolvedValue({ status: 'pending' }),
    ...overrides,
  };
}

function makeKlarna(overrides: Partial<KlarnaAdapter> = {}): KlarnaAdapter {
  return {
    createSession: vi
      .fn()
      .mockResolvedValue({ sessionId: 'klarna-sess-1', approved: true }),
    authorizePayment: vi
      .fn()
      .mockResolvedValue({ paymentId: 'klarna-pay-1', status: 'authorized' }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    getOrderStatus: vi
      .fn()
      .mockResolvedValue({ status: 'pending' }),
    ...overrides,
  };
}

function makeDeps(
  db: ReturnType<typeof makeDb>,
  twisto?: TwistoAdapter,
  klarna?: KlarnaAdapter,
): ServiceDeps {
  return {
    db: db as unknown as DbAdapter,
    twisto: twisto ?? makeTwisto(),
    klarna: klarna ?? makeKlarna(),
  };
}

// Row helper — DB row (snake_case).
function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bnpl_row_1',
    order_id: 'order-1',
    user_id: 'user-1',
    provider: 'twisto',
    provider_payment_id: 'twisto-pay-1',
    amount_czk: 1000_00,
    due_date: new Date('2026-05-01'),
    deferral_days: 14,
    status: 'active' as BnplPaymentStatus,
    approved_at: new Date('2026-04-15'),
    paid_at: null,
    failure_reason: null,
    created_at: new Date('2026-04-15'),
    updated_at: new Date('2026-04-15'),
    ...overrides,
  };
}

const VALID_INPUT: InitiateBnplInput = {
  orderId: 'order-1',
  userId: 'user-1',
  provider: 'twisto',
  amountCzk: 1000_00,
  deferralDays: 14,
  customerEmail: 'a@b.cz',
  customerName: 'Jana Nováková',
  customerPhone: '+420123456789',
  customerBirthDate: '1990-01-01',
};

// =============================================================================
// initiateBnplPayment
// =============================================================================

describe('initiateBnplPayment — Twisto', () => {
  it('úspěšně vytvoří approved BNPL platbu (Twisto)', async () => {
    const db = makeDb({ queryResults: [[]] });   // žádné past payments
    const twisto = makeTwisto({
      createPayment: vi.fn().mockResolvedValue({ paymentId: 'twisto-XY', approved: true }),
    });
    const deps = makeDeps(db, twisto);

    const result = await initiateBnplPayment(VALID_INPUT, deps);

    expect(result.status).toBe('approved');
    expect(result.provider).toBe('twisto');
    expect(result.providerPaymentId).toBe('twisto-XY');
    expect(result.amountCzk).toBe(1000_00);
    expect(result.approvedAt).toBeInstanceOf(Date);
    expect(twisto.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1000_00,
        currency: 'CZK',
        orderId: 'order-1',
        deferralDays: 14,
      }),
    );
    // INSERT + UPDATE (outcome) = 2 execute calls.
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('hodí PROVIDER_REJECTED když Twisto odmítne', async () => {
    const db = makeDb({ queryResults: [[]] });
    const twisto = makeTwisto({
      createPayment: vi
        .fn()
        .mockResolvedValue({ paymentId: 'twisto-R', approved: false, rejectReason: 'risk score too low' }),
    });
    const deps = makeDeps(db, twisto);

    await expect(initiateBnplPayment(VALID_INPUT, deps)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
    });
  });

  it('hodí PROVIDER_ERROR a uloží failure_reason při výjimce od Twisto', async () => {
    const db = makeDb({ queryResults: [[]] });
    const twisto = makeTwisto({
      createPayment: vi.fn().mockRejectedValue(new Error('network timeout')),
    });
    const deps = makeDeps(db, twisto);

    await expect(initiateBnplPayment(VALID_INPUT, deps)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });

    // Měl by se provést INSERT + UPDATE(rejected).
    const calls = db.execute.mock.calls;
    const hasFailureUpdate = calls.some((c: unknown[]) =>
      String(c[0]).includes('failure_reason = $2') && String((c[1] as unknown[])[1]).includes('network timeout'),
    );
    expect(hasFailureUpdate).toBe(true);
  });
});

describe('initiateBnplPayment — Klarna', () => {
  it('úspěšně vytvoří approved BNPL platbu (Klarna)', async () => {
    const db = makeDb({ queryResults: [[]] });
    const klarna = makeKlarna({
      createSession: vi.fn().mockResolvedValue({ sessionId: 'sess-AA', approved: true }),
      authorizePayment: vi.fn().mockResolvedValue({ paymentId: 'kl-pay-AA', status: 'authorized' }),
    });
    const deps = makeDeps(db, undefined, klarna);

    const input: InitiateBnplInput = { ...VALID_INPUT, provider: 'klarna' };
    const result = await initiateBnplPayment(input, deps);

    expect(result.status).toBe('approved');
    expect(result.providerPaymentId).toBe('kl-pay-AA');
    expect(klarna.createSession).toHaveBeenCalled();
    expect(klarna.authorizePayment).toHaveBeenCalledWith('sess-AA');
  });

  it('Klarna: pokud session není approved, výsledek je rejected', async () => {
    const db = makeDb({ queryResults: [[]] });
    const klarna = makeKlarna({
      createSession: vi.fn().mockResolvedValue({ sessionId: 'sess-BB', approved: false }),
    });
    const deps = makeDeps(db, undefined, klarna);

    const input: InitiateBnplInput = { ...VALID_INPUT, provider: 'klarna' };
    await expect(initiateBnplPayment(input, deps)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
    });
    expect(klarna.authorizePayment).not.toHaveBeenCalled();
  });

  it('Klarna: authorize vrátí neautorizovaný status → rejected', async () => {
    const db = makeDb({ queryResults: [[]] });
    const klarna = makeKlarna({
      createSession: vi.fn().mockResolvedValue({ sessionId: 'sess-CC', approved: true }),
      authorizePayment: vi.fn().mockResolvedValue({ paymentId: 'kl-pay-CC', status: 'declined' }),
    });
    const deps = makeDeps(db, undefined, klarna);

    const input: InitiateBnplInput = { ...VALID_INPUT, provider: 'klarna' };
    await expect(initiateBnplPayment(input, deps)).rejects.toMatchObject({
      code: 'PROVIDER_REJECTED',
    });
  });
});

describe('initiateBnplPayment — validation', () => {
  it('hodí AMOUNT_TOO_LOW pokud je částka pod minimem', async () => {
    const db = makeDb();
    const deps = makeDeps(db);
    const input: InitiateBnplInput = { ...VALID_INPUT, amountCzk: 100_00 }; // 100 CZK < 200 CZK min
    await expect(initiateBnplPayment(input, deps)).rejects.toMatchObject({
      code: 'AMOUNT_TOO_LOW',
    });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('hodí AMOUNT_TOO_HIGH pokud je částka nad maximem', async () => {
    const db = makeDb();
    const deps = makeDeps(db);
    const input: InitiateBnplInput = { ...VALID_INPUT, amountCzk: 60_000_00 };
    await expect(initiateBnplPayment(input, deps)).rejects.toMatchObject({
      code: 'AMOUNT_TOO_HIGH',
    });
  });

  it('hodí INVALID_DEFERRAL_DAYS pro hodnoty mimo 14/30', async () => {
    const db = makeDb();
    const deps = makeDeps(db);
    const input = { ...VALID_INPUT, deferralDays: 21 as unknown as 14 | 30 };
    await expect(initiateBnplPayment(input, deps)).rejects.toMatchObject({
      code: 'INVALID_DEFERRAL_DAYS',
    });
  });

  it('hodí USER_NOT_ELIGIBLE pokud má uživatel overdue platbu', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'old', status: 'overdue' })]],
    });
    const deps = makeDeps(db);
    await expect(initiateBnplPayment(VALID_INPUT, deps)).rejects.toMatchObject({
      code: 'USER_NOT_ELIGIBLE',
    });
  });

  it('hodí USER_NOT_ELIGIBLE pokud má 3+ aktivních BNPL plateb', async () => {
    const active = [
      dbRow({ id: 'a', status: 'active', amount_czk: 1_000_00 }),
      dbRow({ id: 'b', status: 'active', amount_czk: 1_000_00 }),
      dbRow({ id: 'c', status: 'approved', amount_czk: 1_000_00 }),
    ];
    const db = makeDb({ queryResults: [active] });
    const deps = makeDeps(db);
    await expect(initiateBnplPayment(VALID_INPUT, deps)).rejects.toMatchObject({
      code: 'USER_NOT_ELIGIBLE',
    });
  });

  it('hodí USER_NOT_ELIGIBLE pokud nová platba přesáhne limit expozice', async () => {
    const past = [
      dbRow({ id: 'a', status: 'active', amount_czk: 99_500_00 }),
    ];
    const db = makeDb({ queryResults: [past] });
    const deps = makeDeps(db);
    const input: InitiateBnplInput = { ...VALID_INPUT, amountCzk: 1_000_00 };
    await expect(initiateBnplPayment(input, deps)).rejects.toMatchObject({
      code: 'USER_NOT_ELIGIBLE',
    });
  });
});

// =============================================================================
// getBnplPayment
// =============================================================================

describe('getBnplPayment', () => {
  it('vrátí platbu pokud existuje', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-1' })]] });
    const deps = makeDeps(db);
    const r = await getBnplPayment('bnpl-1', deps);
    expect(r.id).toBe('bnpl-1');
    expect(r.orderId).toBe('order-1');
    expect(r.provider).toBe('twisto');
  });

  it('hodí PAYMENT_NOT_FOUND když platba neexistuje', async () => {
    const db = makeDb({ queryResults: [[]] });
    const deps = makeDeps(db);
    await expect(getBnplPayment('missing', deps)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
  });
});

// =============================================================================
// listBnplPaymentsForUser
// =============================================================================

describe('listBnplPaymentsForUser', () => {
  it('vrátí všechny platby uživatele, namapované na camelCase', async () => {
    const db = makeDb({
      queryResults: [[
        dbRow({ id: 'a', status: 'active' }),
        dbRow({ id: 'b', status: 'paid', paid_at: new Date('2026-04-01') }),
      ]],
    });
    const deps = makeDeps(db);
    const list = await listBnplPaymentsForUser('user-1', deps);
    expect(list).toHaveLength(2);
    expect(list[0]!.id).toBe('a');
    expect(list[1]!.status).toBe('paid');
    expect(list[1]!.paidAt).toBeInstanceOf(Date);
  });

  it('vrátí prázdné pole, pokud uživatel nemá žádné platby', async () => {
    const db = makeDb({ queryResults: [[]] });
    const deps = makeDeps(db);
    const list = await listBnplPaymentsForUser('nobody', deps);
    expect(list).toEqual([]);
  });
});

// =============================================================================
// markAsDelivered
// =============================================================================

describe('markAsDelivered', () => {
  it('přesune approved → active', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-X', status: 'approved' })]] });
    const deps = makeDeps(db);
    const r = await markAsDelivered('bnpl-X', deps);
    expect(r.status).toBe('active');
    const [sql, params] = db.execute.mock.calls[0]!;
    expect(String(sql)).toContain("status = 'active'");
    expect((params as unknown[])[0]).toBe('bnpl-X');
  });

  it('odmítne pokud není ve stavu approved', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-Y', status: 'pending' })]] });
    const deps = makeDeps(db);
    await expect(markAsDelivered('bnpl-Y', deps)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CANCELLABLE',
    });
  });
});

// =============================================================================
// cancelBnplPayment
// =============================================================================

describe('cancelBnplPayment', () => {
  it('zruší pending platbu bez provider_payment_id', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-C', status: 'pending', provider_payment_id: null })]],
    });
    const deps = makeDeps(db);
    const r = await cancelBnplPayment('bnpl-C', 'user-1', deps);
    expect(r.status).toBe('cancelled');
    // Protože není provider_payment_id, provider.cancelPayment se nevolá.
    expect((deps.twisto.cancelPayment as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('zruší approved platbu a zavolá provider cancel (Twisto)', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-D', status: 'approved', provider: 'twisto', provider_payment_id: 'tw-1' })]],
    });
    const twisto = makeTwisto();
    const deps = makeDeps(db, twisto);
    const r = await cancelBnplPayment('bnpl-D', 'user-1', deps);
    expect(r.status).toBe('cancelled');
    expect(twisto.cancelPayment).toHaveBeenCalledWith('tw-1');
  });

  it('zruší approved Klarna platbu a zavolá cancelOrder', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-E', status: 'approved', provider: 'klarna', provider_payment_id: 'kl-1' })]],
    });
    const klarna = makeKlarna();
    const deps = makeDeps(db, undefined, klarna);
    await cancelBnplPayment('bnpl-E', 'user-1', deps);
    expect(klarna.cancelOrder).toHaveBeenCalledWith('kl-1');
  });

  it('odmítne zrušit platbu ve stavu active (PAYMENT_NOT_CANCELLABLE)', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-F', status: 'active' })]] });
    const deps = makeDeps(db);
    await expect(cancelBnplPayment('bnpl-F', 'user-1', deps)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CANCELLABLE',
    });
  });

  it('odmítne zrušit platbu ve stavu paid', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-G', status: 'paid' })]] });
    const deps = makeDeps(db);
    await expect(cancelBnplPayment('bnpl-G', 'user-1', deps)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CANCELLABLE',
    });
  });

  it('vrátí PROVIDER_ERROR když provider cancel selže', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-H', status: 'approved', provider: 'twisto', provider_payment_id: 'tw-H' })]],
    });
    const twisto = makeTwisto({
      cancelPayment: vi.fn().mockRejectedValue(new Error('provider 500')),
    });
    const deps = makeDeps(db, twisto);
    await expect(cancelBnplPayment('bnpl-H', 'user-1', deps)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    });
  });
});

// =============================================================================
// syncBnplStatus
// =============================================================================

describe('syncBnplStatus', () => {
  it('Twisto: paid → nastaví status=paid a paidAt', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-P1', status: 'active', provider: 'twisto', provider_payment_id: 'tw-P1' })]],
    });
    const twisto = makeTwisto({
      getPaymentStatus: vi.fn().mockResolvedValue({ status: 'paid', paidAt: '2026-04-10T12:00:00Z' }),
    });
    const deps = makeDeps(db, twisto);

    const r = await syncBnplStatus('bnpl-P1', deps);
    expect(r.status).toBe('paid');
    expect(r.paidAt).toBeInstanceOf(Date);
    const sql = db.execute.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'paid'");
  });

  it('Klarna: captured → nastaví status=paid', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-P2', status: 'active', provider: 'klarna', provider_payment_id: 'kl-P2' })]],
    });
    const klarna = makeKlarna({
      getOrderStatus: vi.fn().mockResolvedValue({ status: 'captured', capturedAt: '2026-04-11T09:30:00Z' }),
    });
    const deps = makeDeps(db, undefined, klarna);

    const r = await syncBnplStatus('bnpl-P2', deps);
    expect(r.status).toBe('paid');
  });

  it('provider hlásí defaulted → nastaví status=defaulted', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-D1', status: 'active', provider: 'twisto', provider_payment_id: 'tw-D' })]],
    });
    const twisto = makeTwisto({
      getPaymentStatus: vi.fn().mockResolvedValue({ status: 'defaulted' }),
    });
    const deps = makeDeps(db, twisto);

    const r = await syncBnplStatus('bnpl-D1', deps);
    expect(r.status).toBe('defaulted');
  });

  it('unchanged status → nic neaktualizuje', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-U1', status: 'active', provider: 'twisto', provider_payment_id: 'tw-U' })]],
    });
    const twisto = makeTwisto({
      getPaymentStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
    });
    const deps = makeDeps(db, twisto);

    const r = await syncBnplStatus('bnpl-U1', deps);
    expect(r.status).toBe('active');
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('sync na non-active platbě se vrátí beze změny bez provider volání', async () => {
    const db = makeDb({
      queryResults: [[dbRow({ id: 'bnpl-U2', status: 'paid', provider: 'twisto', provider_payment_id: 'tw-Z' })]],
    });
    const twisto = makeTwisto();
    const deps = makeDeps(db, twisto);

    const r = await syncBnplStatus('bnpl-U2', deps);
    expect(r.status).toBe('paid');
    expect(twisto.getPaymentStatus).not.toHaveBeenCalled();
  });
});

// =============================================================================
// getOverduePayments & markAsOverdue
// =============================================================================

describe('getOverduePayments', () => {
  it('vrátí seznam platby filtrovaných SQL dotazem na status=active a due_date<NOW()', async () => {
    const db = makeDb({
      queryResults: [[
        dbRow({ id: 'od-1', status: 'active', due_date: new Date('2026-03-01') }),
        dbRow({ id: 'od-2', status: 'active', due_date: new Date('2026-03-20') }),
      ]],
    });
    const deps = makeDeps(db);
    const list = await getOverduePayments(deps);
    expect(list).toHaveLength(2);
    const sql = db.query.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain('due_date < NOW()');
  });

  it('vrátí prázdné pole, pokud nikdo není po splatnosti', async () => {
    const db = makeDb({ queryResults: [[]] });
    const deps = makeDeps(db);
    const list = await getOverduePayments(deps);
    expect(list).toEqual([]);
  });
});

describe('markAsOverdue', () => {
  it('active → overdue', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-OD', status: 'active' })]] });
    const deps = makeDeps(db);
    const r = await markAsOverdue('bnpl-OD', deps);
    expect(r.status).toBe('overdue');
    const sql = db.execute.mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'overdue'");
  });

  it('odmítne jiný než active status', async () => {
    const db = makeDb({ queryResults: [[dbRow({ id: 'bnpl-NO', status: 'approved' })]] });
    const deps = makeDeps(db);
    await expect(markAsOverdue('bnpl-NO', deps)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_CANCELLABLE',
    });
  });
});

// =============================================================================
// BnplError class
// =============================================================================

describe('BnplError', () => {
  it('má správné name a code', () => {
    const e = new BnplError('PAYMENT_NOT_FOUND', 'xx');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(BnplError);
    expect(e.name).toBe('BnplError');
    expect(e.code).toBe('PAYMENT_NOT_FOUND');
    expect(e.message).toBe('xx');
  });
});

// Silence unused imports lint if any.
void beforeEach;
