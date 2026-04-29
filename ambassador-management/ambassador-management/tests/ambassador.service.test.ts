import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAmbassador,
  assignCode,
  useCode,
  getStats,
  listAmbassadors,
  requestPayout,
} from '../src/services/ambassador.service';
import {
  AmbassadorNotFoundError,
  CodeExhaustedError,
  AmbassadorSuspendedError,
} from '../src/types/ambassador.types';
import { generateAmbassadorCode, isValidAmbassadorCode } from '../src/lib/code-generator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeDb() {
  return {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn(),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    }),
  };
}

function makeDeps() {
  return {
    db: makeDb(),
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

const FUTURE_DATE = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
const PAST_DATE = new Date(Date.now() - 1000);

// ---------------------------------------------------------------------------
// code-generator
// ---------------------------------------------------------------------------
describe('generateAmbassadorCode()', () => {
  it('vrátí řetězec délky 8', () => {
    expect(generateAmbassadorCode()).toHaveLength(8);
  });

  it('obsahuje pouze povolené znaky (bez O, 0, I, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateAmbassadorCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it('generuje unikátní kódy (100 iterací)', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateAmbassadorCode()));
    expect(codes.size).toBe(100);
  });
});

describe('isValidAmbassadorCode()', () => {
  it('vrátí true pro platný 8-znakový kód', () => {
    expect(isValidAmbassadorCode('ABCD2345')).toBe(true);
  });

  it('vrátí false pro kód s méně než 8 znaky', () => {
    expect(isValidAmbassadorCode('ABCD234')).toBe(false);
  });

  it('vrátí false pro kód obsahující zakázaný znak 0', () => {
    expect(isValidAmbassadorCode('ABCD0234')).toBe(false);
  });

  it('vrátí false pro kód s malými písmeny', () => {
    expect(isValidAmbassadorCode('abcd2345')).toBe(false);
  });

  it('vrátí false pro prázdný řetězec', () => {
    expect(isValidAmbassadorCode('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createAmbassador
// ---------------------------------------------------------------------------
describe('createAmbassador()', () => {
  it('vytvoří ambassadora s tier bronze a wallet 0', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{ id: 'amb_1', created_at: new Date() }]);

    const result = await createAmbassador(deps, 'promo_1', {
      userId: 'user_1',
      name: 'Jan Novák',
      commissionRateBps: 500,
    });

    expect(result.id).toBe('amb_1');
    expect(result.tier).toBe('bronze');
    expect(result.walletBalance).toBe(0);
    expect(result.status).toBe('active');
    expect(result.commissionRateBps).toBe(500);
  });

  it('respektuje explicitně zadaný tier gold', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{ id: 'amb_2', created_at: new Date() }]);

    const result = await createAmbassador(deps, 'promo_1', {
      userId: 'user_2',
      name: 'VIP Star',
      tier: 'gold',
      commissionRateBps: 3000,
    });
    expect(result.tier).toBe('gold');
    expect(result.commissionRateBps).toBe(3000);
  });

  it('vyhodí RangeError pro commissionRateBps > 3000', async () => {
    const deps = makeDeps();
    await expect(
      createAmbassador(deps, 'promo_1', { userId: 'u', name: 'X', commissionRateBps: 3001 }),
    ).rejects.toThrow(RangeError);
  });

  it('vyhodí RangeError pro záporné commissionRateBps', async () => {
    const deps = makeDeps();
    await expect(
      createAmbassador(deps, 'promo_1', { userId: 'u', name: 'X', commissionRateBps: -1 }),
    ).rejects.toThrow(RangeError);
  });

  it('vyhodí RangeError pro necelé commissionRateBps', async () => {
    const deps = makeDeps();
    await expect(
      createAmbassador(deps, 'promo_1', { userId: 'u', name: 'X', commissionRateBps: 5.5 }),
    ).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// assignCode
// ---------------------------------------------------------------------------
describe('assignCode()', () => {
  it('přidělí kód aktivnímu ambassadorovi', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([{ status: 'active' }])         // ambassador check
      .mockResolvedValueOnce([])                              // code collision check
      .mockResolvedValueOnce([{ id: 'code_1', created_at: new Date() }]); // INSERT

    const result = await assignCode(deps, 'promo_1', 'amb_1', {
      maxUses: 100,
      discountBps: 1000,
      validUntil: FUTURE_DATE,
    });

    expect(result.ambassadorId).toBe('amb_1');
    expect(result.code).toHaveLength(8);
    expect(result.maxUses).toBe(100);
    expect(result.usedCount).toBe(0);
    expect(result.discountBps).toBe(1000);
  });

  it('vyhodí AmbassadorNotFoundError pro neexistujícího ambassadora', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]); // prázdný výsledek

    await expect(
      assignCode(deps, 'promo_1', 'amb_999', { maxUses: 10, discountBps: 500, validUntil: FUTURE_DATE }),
    ).rejects.toThrow(AmbassadorNotFoundError);
  });

  it('vyhodí AmbassadorSuspendedError pro suspendovaného ambassadora', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{ status: 'suspended' }]);

    await expect(
      assignCode(deps, 'promo_1', 'amb_1', { maxUses: 10, discountBps: 500, validUntil: FUTURE_DATE }),
    ).rejects.toThrow(AmbassadorSuspendedError);
  });

  it('vyhodí RangeError pro discountBps > 5000', async () => {
    const deps = makeDeps();
    await expect(
      assignCode(deps, 'promo_1', 'amb_1', { maxUses: 10, discountBps: 5001, validUntil: FUTURE_DATE }),
    ).rejects.toThrow(RangeError);
  });

  it('vyhodí RangeError pro maxUses < 1', async () => {
    const deps = makeDeps();
    await expect(
      assignCode(deps, 'promo_1', 'amb_1', { maxUses: 0, discountBps: 500, validUntil: FUTURE_DATE }),
    ).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// useCode
// ---------------------------------------------------------------------------
describe('useCode()', () => {
  const validCodeRow = {
    code_id: 'c_1',
    ambassador_id: 'amb_1',
    max_uses: 100,
    used_count: 5,
    discount_bps: 1000,
    valid_until: FUTURE_DATE,
    ambassador_status: 'active',
    commission_rate_bps: 500,
  };

  it('použije kód, vrátí discountBps a spočítá provizi', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn()
          .mockResolvedValueOnce([validCodeRow])
          .mockResolvedValueOnce([{ id: 'usage_1' }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    const result = await useCode(deps, 'ABCD2345', 'order_1', 100_000);

    expect(result.discountBps).toBe(1000);
    // 100_000 × 500 / 10_000 = 5 000
    expect(result.commission).toBe(5_000);
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'tixly.ambassador.code-used',
      expect.objectContaining({ orderId: 'order_1', commission: 5_000 }),
    );
  });

  it('commission je vždy celé číslo (Math.floor)', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn()
          .mockResolvedValueOnce([{ ...validCodeRow, commission_rate_bps: 333 }])
          .mockResolvedValueOnce([{ id: 'usage_2' }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    const result = await useCode(deps, 'ABCD2345', 'order_2', 100_001);
    // 100_001 × 333 = 33_300_333 / 10_000 = 3330.0333 → floor → 3330
    expect(Number.isInteger(result.commission)).toBe(true);
    expect(result.commission).toBe(3330);
  });

  it('idempotentní — ON CONFLICT DO NOTHING vrátí commission 0', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn()
          .mockResolvedValueOnce([validCodeRow])
          .mockResolvedValueOnce([]), // ON CONFLICT DO NOTHING → []
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    const result = await useCode(deps, 'ABCD2345', 'order_dup', 100_000);
    expect(result.commission).toBe(0);
  });

  it('vyhodí CodeExhaustedError když used_count >= max_uses', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([{ ...validCodeRow, used_count: 100, max_uses: 100 }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(useCode(deps, 'ABCD2345', 'order_3', 50_000)).rejects.toThrow(CodeExhaustedError);
  });

  it('vyhodí CodeExhaustedError pro expirovaný kód', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([{ ...validCodeRow, valid_until: PAST_DATE }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(useCode(deps, 'ABCD2345', 'order_4', 50_000)).rejects.toThrow(CodeExhaustedError);
  });

  it('vyhodí AmbassadorSuspendedError pro suspendovaného ambassadora', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([{ ...validCodeRow, ambassador_status: 'suspended' }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(useCode(deps, 'ABCD2345', 'order_5', 50_000)).rejects.toThrow(AmbassadorSuspendedError);
  });

  it('vyhodí AmbassadorNotFoundError pro neexistující kód', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(useCode(deps, 'ABCD2345', 'order_6', 50_000)).rejects.toThrow(AmbassadorNotFoundError);
  });

  it('vyhodí AmbassadorNotFoundError pro neplatný formát kódu', async () => {
    const deps = makeDeps();
    await expect(useCode(deps, 'bad!code', 'order_7', 1000)).rejects.toThrow(AmbassadorNotFoundError);
  });

  it('vyhodí RangeError pro záporný orderAmount', async () => {
    const deps = makeDeps();
    await expect(useCode(deps, 'ABCD2345', 'order_8', -1)).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------
describe('getStats()', () => {
  it('vrátí statistiky se správnou conversionRate', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([{ id: 'amb_1' }])  // ownership check
      .mockResolvedValueOnce([{
        total_sales: 500_000,
        total_commission: 25_000,
        codes_used: 10,
        total_codes: 20,
      }]);

    const stats = await getStats(deps, 'amb_1', 'user_1');
    expect(stats.totalSales).toBe(500_000);
    expect(stats.totalCommission).toBe(25_000);
    expect(stats.codesUsed).toBe(10);
    // 10 / 20 × 100 = 50
    expect(stats.conversionRate).toBe(50);
  });

  it('conversionRate = 0 pokud žádné kódy', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([{ id: 'amb_1' }])
      .mockResolvedValueOnce([{
        total_sales: 0,
        total_commission: 0,
        codes_used: 0,
        total_codes: 0,
      }]);

    const stats = await getStats(deps, 'amb_1', 'user_1');
    expect(stats.conversionRate).toBe(0);
  });

  it('vyhodí AmbassadorNotFoundError pokud ambassador nepatří userId', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]); // ownership check selhá

    await expect(getStats(deps, 'amb_1', 'wrong_user')).rejects.toThrow(AmbassadorNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// listAmbassadors
// ---------------------------------------------------------------------------
describe('listAmbassadors()', () => {
  it('vrátí seznam ambassadorů pro daného promotéra', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([
      {
        id: 'amb_1', user_id: 'u_1', promoter_id: 'promo_1',
        name: 'Alice', tier: 'silver', commission_rate_bps: 1000,
        wallet_balance: 5000, status: 'active', created_at: new Date(),
      },
      {
        id: 'amb_2', user_id: 'u_2', promoter_id: 'promo_1',
        name: 'Bob', tier: 'bronze', commission_rate_bps: 500,
        wallet_balance: 0, status: 'suspended', created_at: new Date(),
      },
    ]);

    const result = await listAmbassadors(deps, 'promo_1');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Alice');
    expect(result[0].tier).toBe('silver');
    expect(result[1].status).toBe('suspended');
  });

  it('vrátí prázdné pole pokud promotér nemá žádné ambassadory', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([]);

    const result = await listAmbassadors(deps, 'promo_empty');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// requestPayout
// ---------------------------------------------------------------------------
describe('requestPayout()', () => {
  it('vytvoří výplatu a vynuluje wallet', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn()
          .mockResolvedValueOnce([{ wallet_balance: 75_000, status: 'active' }])
          .mockResolvedValueOnce([{ id: 'payout_1', created_at: new Date() }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    const result = await requestPayout(deps, 'amb_1', 'user_1');
    expect(result.amount).toBe(75_000);
    expect(result.status).toBe('pending');
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'tixly.ambassador.payout-requested',
      expect.objectContaining({ ambassadorId: 'amb_1', amount: 75_000 }),
    );
  });

  it('vyhodí RangeError pro zůstatek pod minimem 50 000 haléřů', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([{ wallet_balance: 49_999, status: 'active' }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(requestPayout(deps, 'amb_1', 'user_1')).rejects.toThrow(RangeError);
  });

  it('vyhodí RangeError přesně na hranici 49 999 haléřů', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([{ wallet_balance: 1, status: 'active' }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(requestPayout(deps, 'amb_1', 'user_1')).rejects.toThrow(RangeError);
  });

  it('projde přesně na minimální hranici 50 000 haléřů', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn()
          .mockResolvedValueOnce([{ wallet_balance: 50_000, status: 'active' }])
          .mockResolvedValueOnce([{ id: 'payout_min', created_at: new Date() }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    const result = await requestPayout(deps, 'amb_1', 'user_1');
    expect(result.amount).toBe(50_000);
  });

  it('vyhodí AmbassadorNotFoundError pro neexistujícího ambassadora', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(requestPayout(deps, 'amb_999', 'user_1')).rejects.toThrow(AmbassadorNotFoundError);
  });

  it('vyhodí AmbassadorSuspendedError pro suspendovaného ambassadora', async () => {
    const deps = makeDeps();
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn().mockResolvedValueOnce([{ wallet_balance: 100_000, status: 'suspended' }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    await expect(requestPayout(deps, 'amb_1', 'user_1')).rejects.toThrow(AmbassadorSuspendedError);
  });

  it('Kafka send selže tiše — fire and forget', async () => {
    const deps = makeDeps();
    deps.kafka.send = vi.fn().mockRejectedValue(new Error('Kafka nedostupná'));
    deps.db.transaction = vi.fn(async (fn: (tx: ReturnType<typeof makeDb>) => Promise<unknown>) => {
      const tx = {
        query: vi.fn()
          .mockResolvedValueOnce([{ wallet_balance: 60_000, status: 'active' }])
          .mockResolvedValueOnce([{ id: 'payout_2', created_at: new Date() }]),
        execute: vi.fn().mockResolvedValue(undefined),
        transaction: vi.fn(),
      };
      return fn(tx);
    });

    // Nesmí vyhodit chybu i přes selhání Kafky
    await expect(requestPayout(deps, 'amb_1', 'user_1')).resolves.toBeDefined();
  });
});
