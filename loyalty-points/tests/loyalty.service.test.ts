import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  earnPoints,
  redeemPoints,
  getAccount,
  getHistory,
  expireOldPoints,
} from '../src/services/loyalty.service';
import {
  InsufficientPointsError,
  InvalidRedemptionError,
} from '../src/types/loyalty.types';
import type { ServiceDeps } from '../src/services/loyalty.service';

// ---------------------------------------------------------------------------
// Pomocné typy a factory funkce
// ---------------------------------------------------------------------------

type DbAdapter = ServiceDeps['db'];
type KafkaAdapter = ServiceDeps['kafka'];

interface AccountRow {
  id: string;
  user_id: string;
  total_points: number;
  lifetime_points: number;
  tier: string;
  expires_at: string;
}

interface TransactionRow {
  id: string;
  user_id: string;
  type: string;
  points: number;
  order_id: string | null;
  description: string;
  created_at: string;
}

function makeAccountRow(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-001',
    user_id: 'user-1',
    total_points: 1_000,
    lifetime_points: 1_000,
    tier: 'bronze',
    expires_at: new Date('2027-04-05').toISOString(),
    ...overrides,
  };
}

function makeTxRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 'tx-001',
    user_id: 'user-1',
    type: 'earned',
    points: 100,
    order_id: 'order-1',
    description: 'Věrnostní body za objednávku order-1 (100 bodů)',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/** Vytvoří mock DbAdapter s konfigurovatelným query výsledkem */
function makeDb(overrides: Partial<DbAdapter> = {}): DbAdapter {
  return {
    query: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    }),
    ...overrides,
  };
}

function makeKafka(): KafkaAdapter {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(dbOverrides: Partial<DbAdapter> = {}): ServiceDeps {
  return {
    db: makeDb(dbOverrides),
    kafka: makeKafka(),
  };
}

// ---------------------------------------------------------------------------
// earnPoints
// ---------------------------------------------------------------------------

describe('earnPoints', () => {
  it('přidá body a vrátí aktualizovaný účet', async () => {
    const accountRow = makeAccountRow({ total_points: 200, lifetime_points: 200 });
    const db = makeDb();
    // První query = getAccount po upsert, druhý query = prázdno (nový účet)
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // aktuální účet před upsert
      .mockResolvedValueOnce([accountRow]); // getAccount po upsert
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    const result = await earnPoints(deps, 'user-1', 'order-1', 10_000);

    expect(result.userId).toBe('user-1');
    expect(result.totalPoints).toBe(200);
  });

  it('volá db.transaction pro atomický upsert', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await earnPoints(deps, 'user-1', 'order-1', 10_000);

    expect(deps.db.transaction).toHaveBeenCalled();
  });

  it('publikuje Kafka event loyalty.points_earned', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await earnPoints(deps, 'user-1', 'order-1', 10_000);

    expect(deps.kafka.send).toHaveBeenCalledWith(
      'loyalty.points_earned',
      expect.objectContaining({
        userId: 'user-1',
        orderId: 'order-1',
      }),
    );
  });

  it('vrátí prázdný účet pro 0 Kč objednávku (0 bodů)', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await earnPoints(deps, 'user-1', 'order-1', 0);

    expect(result.totalPoints).toBe(0);
    // transaction se nevolá (žádné body)
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('silver tier zákazník dostane 1.5× více bodů', async () => {
    const silverAccountRow = makeAccountRow({ tier: 'silver', lifetime_points: 6_000, total_points: 6_000 });
    const db = makeDb();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([silverAccountRow]) // aktuální účet
      .mockResolvedValueOnce([{ ...silverAccountRow, total_points: 6_150, lifetime_points: 6_150 }]); // po upsert
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    const result = await earnPoints(deps, 'user-1', 'order-2', 10_000);

    // 100 Kč × 1.5 = 150 bodů
    expect(result.totalPoints).toBe(6_150);
  });

  it('gold tier zákazník: 100 Kč → 200 bodů', async () => {
    const goldRow = makeAccountRow({ tier: 'gold', lifetime_points: 20_000, total_points: 20_000 });
    const db = makeDb();
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([goldRow])
      .mockResolvedValueOnce([{ ...goldRow, total_points: 20_200, lifetime_points: 20_200 }]);
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    const result = await earnPoints(deps, 'user-1', 'order-3', 10_000);

    expect(result.totalPoints).toBe(20_200);
  });

  it('kafka chyba neblokuje response (fire-and-forget)', async () => {
    const deps = makeDeps();
    (deps.db.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (deps.kafka.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Kafka down'));

    // Nemělo by vyhodit chybu
    await expect(earnPoints(deps, 'user-1', 'order-1', 10_000)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// redeemPoints
// ---------------------------------------------------------------------------

describe('redeemPoints', () => {
  it('odečte body a vrátí discount amount pro option=discount', async () => {
    const accountRow = makeAccountRow({ total_points: 2_000 });
    const db = makeDb();
    // transaction mock: query vrátí accountRow, execute nic
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([accountRow]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    const result = await redeemPoints(deps, 'user-1', 500, 'discount');

    expect(result.option).toBe('discount');
    expect(result.discountAmount).toBe(500); // 500 bodů = 500 haléřů = 5 Kč
    expect(result.remainingPoints).toBe(1_500);
  });

  it('vrátí free_ticket flag pro option=free_ticket', async () => {
    const accountRow = makeAccountRow({ total_points: 5_000 });
    const db = makeDb();
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([accountRow]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    const result = await redeemPoints(deps, 'user-1', 1_000, 'free_ticket');

    expect(result.option).toBe('free_ticket');
    expect(result.freeTicket).toBe(true);
    expect(result.remainingPoints).toBe(4_000);
  });

  it('hází InsufficientPointsError pokud nemá dost bodů', async () => {
    const accountRow = makeAccountRow({ total_points: 100 });
    const db = makeDb();
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([accountRow]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    await expect(redeemPoints(deps, 'user-1', 500, 'discount')).rejects.toThrow(
      InsufficientPointsError,
    );
  });

  it('hází InsufficientPointsError pokud účet neexistuje', async () => {
    const db = makeDb();
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([]), // prázdné — účet neexistuje
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    await expect(redeemPoints(deps, 'user-1', 100, 'discount')).rejects.toThrow(
      InsufficientPointsError,
    );
  });

  it('hází InvalidRedemptionError pro 0 bodů', async () => {
    const deps = makeDeps();

    await expect(redeemPoints(deps, 'user-1', 0, 'discount')).rejects.toThrow(
      InvalidRedemptionError,
    );
  });

  it('hází InvalidRedemptionError pro záporný počet bodů', async () => {
    const deps = makeDeps();

    await expect(redeemPoints(deps, 'user-1', -100, 'discount')).rejects.toThrow(
      InvalidRedemptionError,
    );
  });

  it('hází InvalidRedemptionError pro free_ticket s méně než 1000 body', async () => {
    const deps = makeDeps();

    await expect(redeemPoints(deps, 'user-1', 999, 'free_ticket')).rejects.toThrow(
      InvalidRedemptionError,
    );
  });

  it('publikuje Kafka event loyalty.points_redeemed', async () => {
    const accountRow = makeAccountRow({ total_points: 2_000 });
    const db = makeDb();
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([accountRow]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const kafka = makeKafka();
    const deps: ServiceDeps = { db, kafka };

    await redeemPoints(deps, 'user-1', 500, 'discount');

    expect(kafka.send).toHaveBeenCalledWith(
      'loyalty.points_redeemed',
      expect.objectContaining({ userId: 'user-1', points: 500 }),
    );
  });

  it('provede v db.transaction (atomicita)', async () => {
    const accountRow = makeAccountRow({ total_points: 2_000 });
    const db = makeDb();
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([accountRow]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    await redeemPoints(deps, 'user-1', 500, 'discount');

    expect(db.transaction).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// getAccount
// ---------------------------------------------------------------------------

describe('getAccount', () => {
  it('vrátí mapovaný účet z DB', async () => {
    const row = makeAccountRow({ total_points: 3_000, lifetime_points: 5_000, tier: 'silver' });
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([row]) });

    const account = await getAccount(deps, 'user-1');

    expect(account.userId).toBe('user-1');
    expect(account.totalPoints).toBe(3_000);
    expect(account.lifetimePoints).toBe(5_000);
    expect(account.tier).toBe('silver');
  });

  it('vrátí prázdný virtuální účet pokud neexistuje v DB', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });

    const account = await getAccount(deps, 'user-new');

    expect(account.userId).toBe('user-new');
    expect(account.totalPoints).toBe(0);
    expect(account.lifetimePoints).toBe(0);
    expect(account.tier).toBe('bronze');
  });

  it('expiresAt je v budoucnosti pro nového zákazníka', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });

    const account = await getAccount(deps, 'user-new');

    expect(account.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// getHistory
// ---------------------------------------------------------------------------

describe('getHistory', () => {
  it('vrátí transakce namapované z DB', async () => {
    const rows = [
      makeTxRow({ id: 'tx-1', type: 'earned', points: 100 }),
      makeTxRow({ id: 'tx-2', type: 'redeemed', points: 50, order_id: null }),
    ];
    const deps = makeDeps({ query: vi.fn().mockResolvedValue(rows) });

    const history = await getHistory(deps, 'user-1');

    expect(history).toHaveLength(2);
    expect(history[0]!.id).toBe('tx-1');
    expect(history[0]!.type).toBe('earned');
    expect(history[1]!.type).toBe('redeemed');
  });

  it('používá defaultní limit 50', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValue([]) });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    await getHistory(deps, 'user-1');

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['user-1', 50]),
    );
  });

  it('respektuje vlastní limit', async () => {
    const db = makeDb({ query: vi.fn().mockResolvedValue([]) });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    await getHistory(deps, 'user-1', 10);

    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['user-1', 10]),
    );
  });

  it('vrátí prázdné pole pokud žádná history', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });

    const history = await getHistory(deps, 'user-1');

    expect(history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// expireOldPoints
// ---------------------------------------------------------------------------

describe('expireOldPoints', () => {
  it('vrátí 0 pokud žádné účty k expiraci', async () => {
    const deps = makeDeps({ query: vi.fn().mockResolvedValue([]) });

    const count = await expireOldPoints(deps);

    expect(count).toBe(0);
    expect(deps.db.transaction).not.toHaveBeenCalled();
  });

  it('expiruje body u všech účtů s prošlou lhůtou', async () => {
    const expiredRows = [
      makeAccountRow({ id: 'acc-1', user_id: 'user-1', total_points: 500 }),
      makeAccountRow({ id: 'acc-2', user_id: 'user-2', total_points: 200 }),
    ];
    const db = makeDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(expiredRows);
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    const count = await expireOldPoints(deps);

    expect(count).toBe(2);
  });

  it('publikuje Kafka event loyalty.points_expired pro každý účet', async () => {
    const expiredRows = [
      makeAccountRow({ id: 'acc-1', user_id: 'user-1', total_points: 500 }),
    ];
    const db = makeDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(expiredRows);
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const kafka = makeKafka();
    const deps: ServiceDeps = { db, kafka };

    await expireOldPoints(deps);

    expect(kafka.send).toHaveBeenCalledWith(
      'loyalty.points_expired',
      expect.objectContaining({
        userId: 'user-1',
        pointsExpired: 500,
      }),
    );
  });

  it('pokračuje při chybě transakce pro jeden účet (ostatní se expirují)', async () => {
    const expiredRows = [
      makeAccountRow({ id: 'acc-1', user_id: 'user-1', total_points: 500 }),
      makeAccountRow({ id: 'acc-2', user_id: 'user-2', total_points: 200 }),
    ];
    const db = makeDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(expiredRows);

    let callCount = 0;
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('DB error pro user-1');
      }
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    // Nemělo by vyhodit chybu — pokračuje dál
    const count = await expireOldPoints(deps);

    // 1 úspěšná (user-2), 1 selhala (user-1 byla přeskočena)
    expect(count).toBe(1);
  });

  it('vynuluje total_points v DB (execute je voláno)', async () => {
    const expiredRows = [makeAccountRow({ total_points: 999 })];
    const db = makeDb();
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValue(expiredRows);
    const executeMock = vi.fn().mockResolvedValue(undefined);
    db.transaction = vi.fn().mockImplementation(async (fn: (tx: DbAdapter) => Promise<unknown>) => {
      const tx: DbAdapter = {
        query: vi.fn().mockResolvedValue([]),
        execute: executeMock,
        transaction: vi.fn(),
      };
      return fn(tx);
    });
    const deps: ServiceDeps = { db, kafka: makeKafka() };

    await expireOldPoints(deps);

    // execute voláno alespoň jednou (UPDATE accounts + INSERT transaction)
    expect(executeMock).toHaveBeenCalled();
  });
});
