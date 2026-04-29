import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveCart, markConverted, recoverCart } from '../src/services/cart.service';
import { CartNotFoundError, CartTokenExpiredError, CartAlreadyConvertedError } from '../src/types/cart.types';

function makeDb() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(makeDb())),
  };
}
function makeDeps(dbOverrides = {}) {
  return {
    db: { ...makeDb(), ...dbOverrides },
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

const ITEMS = [{ ticketTypeId: 'tt_1', ticketTypeName: 'Standard', quantity: 2, unitPrice: 89900 }];

describe('saveCart()', () => {
  it('uloží košík a vrátí správný totalAmount', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      id: 'cart_1', status: 'active', ab_variant: 'A',
      created_at: new Date(), updated_at: new Date(),
    }]);

    const result = await saveCart(deps, 'user_1', { eventId: 'evt_1', items: ITEMS });

    expect(result.totalAmount).toBe(179800);   // 2 × 89900 haléřů
    expect(result.status).toBe('active');
    expect(result.userId).toBe('user_1');
  });

  it('přiřadí A/B variant deterministicky', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValue([{
      id: 'cart_1', status: 'active', ab_variant: 'A',
      created_at: new Date(), updated_at: new Date(),
    }]);

    const r1 = await saveCart(deps, 'user_stable', { eventId: 'evt_1', items: ITEMS });
    const r2 = await saveCart(deps, 'user_stable', { eventId: 'evt_1', items: ITEMS });
    expect(r1.abVariant).toBe(r2.abVariant);
  });

  it('pošle Kafka event po uložení', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      id: 'cart_1', status: 'active', ab_variant: 'B',
      created_at: new Date(), updated_at: new Date(),
    }]);

    await saveCart(deps, 'user_1', { eventId: 'evt_1', items: ITEMS });
    expect(deps.kafka.send).toHaveBeenCalledWith('tixly.cart.saved', expect.objectContaining({ cartId: 'cart_1' }));
  });

  it('totalAmount = 0 pro prázdné items (edge case — validace na API vrstvě)', async () => {
    const deps = makeDeps();
    deps.db.query = vi.fn().mockResolvedValueOnce([{
      id: 'cart_1', status: 'active', ab_variant: 'A',
      created_at: new Date(), updated_at: new Date(),
    }]);

    const result = await saveCart(deps, 'user_1', { eventId: 'evt_1', items: [] });
    expect(result.totalAmount).toBe(0);
  });
});

describe('markConverted()', () => {
  it('označí košík jako converted', async () => {
    const deps = makeDeps();
    deps.db.execute = vi.fn().mockResolvedValueOnce(undefined);

    await markConverted(deps, 'user_1', 'evt_1');
    expect(deps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'converted'"),
      ['user_1', 'evt_1'],
    );
  });

  it('pošle Kafka event', async () => {
    const deps = makeDeps();
    deps.db.execute = vi.fn().mockResolvedValueOnce(undefined);

    await markConverted(deps, 'user_1', 'evt_1');
    expect(deps.kafka.send).toHaveBeenCalledWith('tixly.cart.converted', expect.any(Object));
  });
});

describe('recoverCart()', () => {
  it('vyhodí CartTokenExpiredError pro neplatný token', async () => {
    const deps = makeDeps();
    await expect(recoverCart(deps, 'invalid.token.here'))
      .rejects.toThrow(CartTokenExpiredError);
  });

  it('vyhodí CartNotFoundError pokud košík neexistuje', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
    const { generateRecoveryToken } = await import('../src/lib/recovery-token');
    const token = await generateRecoveryToken('cart_xyz', 'user_1');

    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([])          // UPDATE vrátí prázdné
      .mockResolvedValueOnce([]);         // SELECT status → prázdné

    await expect(recoverCart(deps, token)).rejects.toThrow(CartNotFoundError);
  });

  it('vyhodí CartAlreadyConvertedError pro konvertovaný košík', async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
    const { generateRecoveryToken } = await import('../src/lib/recovery-token');
    const token = await generateRecoveryToken('cart_xyz', 'user_1');

    const deps = makeDeps();
    deps.db.query = vi.fn()
      .mockResolvedValueOnce([])                          // UPDATE → prázdné
      .mockResolvedValueOnce([{ status: 'converted' }]); // SELECT status

    await expect(recoverCart(deps, token)).rejects.toThrow(CartAlreadyConvertedError);
  });
});
