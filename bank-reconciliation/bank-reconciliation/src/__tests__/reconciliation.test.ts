import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FioClient, loadFioConfig } from '../lib/fio-client.js';
import type { ServiceDeps } from '../lib/service-container.js';
import {
  pollAndReconcile,
  findUnpaidOrderByVariableSymbol,
} from '../services/reconciliation.service.js';

interface MockDb {
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

interface MockKafka {
  send: ReturnType<typeof vi.fn>;
}

function makeMockDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  const db: MockDb = {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  };
  const kafka: MockKafka = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    db: db as any,
    kafka: kafka as any,
    fioClient: new FioClient({ token: '', apiBaseUrl: 'http://x', isConfigured: false }),
    fioConfig: { token: '', apiBaseUrl: 'http://x', isConfigured: false },
    spaydConfig: { iban: 'CZ1234567890123456789012', bic: 'FIOBCZPP', studioName: 'T', isConfigured: true },
    ...overrides,
  };
}

const sampleFioResponse = (txns: any[]) => ({
  accountStatement: {
    transactionList: {
      transaction: txns,
    },
  },
});

const makeRawTxn = (opts: {
  id: string;
  amountKc: number;
  vs?: string;
  type?: string;
}) => ({
  column22: { value: opts.id, name: 'ID', id: 22 },
  column0: { value: '2026-04-08+0200', name: 'Datum', id: 0 },
  column1: { value: opts.amountKc, name: 'Objem', id: 1 },
  column14: { value: 'CZK', name: 'Měna', id: 14 },
  column5: opts.vs ? { value: opts.vs, name: 'VS', id: 5 } : undefined,
  column8: { value: opts.type ?? 'Příjem převodem', name: 'Typ', id: 8 },
});

describe('pollAndReconcile (dev mode)', () => {
  it('returns zeros and does not call fetch when Fio not configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const deps = makeMockDeps();
    const result = await pollAndReconcile(deps);
    expect(result).toEqual({ fetched: 0, matched: 0, unmatched: 0, errors: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('pollAndReconcile (configured)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function makeConfiguredDeps() {
    const fioConfig = { token: 'tok', apiBaseUrl: 'http://fio.test', isConfigured: true };
    return makeMockDeps({
      fioConfig,
      fioClient: new FioClient(fioConfig),
    });
  }

  function mockFioFetchOnce(txns: any[]) {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleFioResponse(txns)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as any,
    );
  }

  it('parses Fio response and matches by VS (happy path)', async () => {
    const deps = makeConfiguredDeps();
    mockFioFetchOnce([makeRawTxn({ id: 'T1', amountKc: 490, vs: '12345' })]);

    const db = deps.db as unknown as MockDb;
    // 1. INSERT bank_payments -> returns 1 row
    db.query.mockResolvedValueOnce([
      {
        id: 'bp-1',
        fio_transaction_id: 'T1',
        amount_halire: 49000,
        currency: 'CZK',
        variable_symbol: '12345',
        constant_symbol: null,
        specific_symbol: null,
        counter_account: null,
        counter_account_name: null,
        message: null,
        order_id: null,
        match_status: 'unmatched',
        raw_payload: {},
        received_at: new Date(),
        matched_at: null,
      },
    ]);
    // 2. findUnpaidOrderByVariableSymbol
    db.query.mockResolvedValueOnce([{ id: 'order-1', total_halire: 49000 }]);

    const result = await pollAndReconcile(deps);

    expect(result.fetched).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.unmatched).toBe(0);
    expect(db.execute).toHaveBeenCalled(); // update status + mark order paid
    expect((deps.kafka.send as any)).toHaveBeenCalledWith(
      'order.paid',
      expect.objectContaining({ orderId: 'order-1' }),
    );
  });

  it('flags overpaid when amount > expected', async () => {
    const deps = makeConfiguredDeps();
    mockFioFetchOnce([makeRawTxn({ id: 'T2', amountKc: 600, vs: '99' })]);

    const db = deps.db as unknown as MockDb;
    db.query.mockResolvedValueOnce([
      {
        id: 'bp-2',
        fio_transaction_id: 'T2',
        amount_halire: 60000,
        currency: 'CZK',
        variable_symbol: '99',
        constant_symbol: null,
        specific_symbol: null,
        counter_account: null,
        counter_account_name: null,
        message: null,
        order_id: null,
        match_status: 'unmatched',
        raw_payload: {},
        received_at: new Date(),
        matched_at: null,
      },
    ]);
    db.query.mockResolvedValueOnce([{ id: 'order-2', total_halire: 49000 }]);

    const result = await pollAndReconcile(deps);

    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
    const updateCall = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE payments.bank_payments'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]?.[0]).toBe('overpaid');
  });

  it('marks unmatched when VS not found', async () => {
    const deps = makeConfiguredDeps();
    mockFioFetchOnce([makeRawTxn({ id: 'T3', amountKc: 100, vs: '7777' })]);

    const db = deps.db as unknown as MockDb;
    db.query.mockResolvedValueOnce([
      {
        id: 'bp-3',
        fio_transaction_id: 'T3',
        amount_halire: 10000,
        currency: 'CZK',
        variable_symbol: '7777',
        constant_symbol: null,
        specific_symbol: null,
        counter_account: null,
        counter_account_name: null,
        message: null,
        order_id: null,
        match_status: 'unmatched',
        raw_payload: {},
        received_at: new Date(),
        matched_at: null,
      },
    ]);
    // findUnpaidOrderByVariableSymbol returns no rows
    db.query.mockResolvedValueOnce([]);

    const result = await pollAndReconcile(deps);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(1);
  });

  it('idempotent: duplicate fio_transaction_id skipped (INSERT returns no rows)', async () => {
    const deps = makeConfiguredDeps();
    mockFioFetchOnce([makeRawTxn({ id: 'T-dup', amountKc: 100, vs: '1' })]);

    const db = deps.db as unknown as MockDb;
    // ON CONFLICT DO NOTHING → 0 rows
    db.query.mockResolvedValueOnce([]);

    const result = await pollAndReconcile(deps);
    expect(result.fetched).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(0);
    // findUnpaidOrderByVariableSymbol should NOT be called after dedupe skip
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('skips outgoing (VYDAJ) transactions', async () => {
    const deps = makeConfiguredDeps();
    mockFioFetchOnce([makeRawTxn({ id: 'T4', amountKc: 50, type: 'Výdaj' })]);

    const result = await pollAndReconcile(deps);
    expect(result.fetched).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.unmatched).toBe(0);
    expect((deps.db as unknown as MockDb).query).not.toHaveBeenCalled();
  });
});

describe('findUnpaidOrderByVariableSymbol', () => {
  it('returns null on empty VS', async () => {
    const deps = makeMockDeps();
    const result = await findUnpaidOrderByVariableSymbol('', deps);
    expect(result).toBeNull();
  });

  it('returns order when found', async () => {
    const deps = makeMockDeps();
    (deps.db as unknown as MockDb).query.mockResolvedValueOnce([
      { id: 'o-1', total_halire: 12345 },
    ]);
    const result = await findUnpaidOrderByVariableSymbol('9', deps);
    expect(result).toEqual({ orderId: 'o-1', expectedAmountHalire: 12345 });
  });
});

describe('loadFioConfig', () => {
  it('returns isConfigured=false when FIO_TOKEN missing', () => {
    const before = process.env.FIO_TOKEN;
    delete process.env.FIO_TOKEN;
    const cfg = loadFioConfig();
    expect(cfg.isConfigured).toBe(false);
    if (before !== undefined) process.env.FIO_TOKEN = before;
  });
});
