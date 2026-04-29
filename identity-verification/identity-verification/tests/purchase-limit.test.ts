import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasReachedPurchaseLimit,
  recordPurchase,
  type PurchaseLimitDeps,
} from '../src/services/purchase-limit.service.js';

interface Row { identity_hash: string; event_id: string; ticket_count: number }

function makeDeps(): { deps: PurchaseLimitDeps; rows: Row[] } {
  const rows: Row[] = [];
  const deps: PurchaseLimitDeps = {
    db: {
      async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
        // Only one SELECT shape used by the service.
        const [hash, eventId] = params as [string, string];
        const total = rows
          .filter(r => r.identity_hash === hash && r.event_id === eventId)
          .reduce((sum, r) => sum + r.ticket_count, 0);
        return [{ total } as unknown as T];
      },
      async execute(sql: string, params: unknown[] = []): Promise<void> {
        const [hash, eventId, ticketCount] = params as [string, string, number];
        rows.push({ identity_hash: hash, event_id: eventId, ticket_count: ticketCount });
      },
    },
  };
  return { deps, rows };
}

describe('purchase-limit.service', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => { ctx = makeDeps(); });

  it('reports zero count for a fresh identity', async () => {
    const r = await hasReachedPurchaseLimit('h1', 'evt-1', 4, ctx.deps);
    expect(r).toEqual({ reached: false, currentCount: 0 });
  });

  it('sums ticket counts across multiple purchases for same event', async () => {
    await recordPurchase('h1', 'evt-1', 2, ctx.deps);
    await recordPurchase('h1', 'evt-1', 1, ctx.deps);
    const r = await hasReachedPurchaseLimit('h1', 'evt-1', 4, ctx.deps);
    expect(r.currentCount).toBe(3);
    expect(r.reached).toBe(false);
  });

  it('marks reached when sum equals the limit', async () => {
    await recordPurchase('h1', 'evt-1', 4, ctx.deps);
    const r = await hasReachedPurchaseLimit('h1', 'evt-1', 4, ctx.deps);
    expect(r).toEqual({ reached: true, currentCount: 4 });
  });

  it('scopes counts per event (different events do not leak)', async () => {
    await recordPurchase('h1', 'evt-1', 4, ctx.deps);
    const evt2 = await hasReachedPurchaseLimit('h1', 'evt-2', 4, ctx.deps);
    expect(evt2).toEqual({ reached: false, currentCount: 0 });
  });

  it('scopes counts per identity', async () => {
    await recordPurchase('h1', 'evt-1', 4, ctx.deps);
    const other = await hasReachedPurchaseLimit('h2', 'evt-1', 4, ctx.deps);
    expect(other.currentCount).toBe(0);
  });

  it('validates inputs', async () => {
    await expect(hasReachedPurchaseLimit('', 'e', 1, ctx.deps)).rejects.toThrow();
    await expect(hasReachedPurchaseLimit('h', '', 1, ctx.deps)).rejects.toThrow();
    await expect(hasReachedPurchaseLimit('h', 'e', 0, ctx.deps)).rejects.toThrow();
    await expect(recordPurchase('h', 'e', 0, ctx.deps)).rejects.toThrow();
  });

  it('validates negative limit', async () => {
    await expect(hasReachedPurchaseLimit('h', 'e', -1, ctx.deps)).rejects.toThrow(
      'limit must be > 0',
    );
  });

  it('validates negative ticketCount on recordPurchase', async () => {
    await expect(recordPurchase('h', 'e', -5, ctx.deps)).rejects.toThrow(
      'ticketCount must be > 0',
    );
  });

  it('validates empty identityHash on recordPurchase', async () => {
    await expect(recordPurchase('', 'e', 1, ctx.deps)).rejects.toThrow(
      'identityHash required',
    );
  });

  it('validates empty eventId on recordPurchase', async () => {
    await expect(recordPurchase('h', '', 1, ctx.deps)).rejects.toThrow(
      'eventId required',
    );
  });

  it('marks reached when sum exceeds the limit', async () => {
    await recordPurchase('h1', 'evt-1', 3, ctx.deps);
    await recordPurchase('h1', 'evt-1', 2, ctx.deps);
    const r = await hasReachedPurchaseLimit('h1', 'evt-1', 4, ctx.deps);
    expect(r).toEqual({ reached: true, currentCount: 5 });
  });

  it('works with limit=1 (single ticket events)', async () => {
    const r0 = await hasReachedPurchaseLimit('h1', 'evt-1', 1, ctx.deps);
    expect(r0).toEqual({ reached: false, currentCount: 0 });

    await recordPurchase('h1', 'evt-1', 1, ctx.deps);
    const r1 = await hasReachedPurchaseLimit('h1', 'evt-1', 1, ctx.deps);
    expect(r1).toEqual({ reached: true, currentCount: 1 });
  });

  it('handles multiple identities for the same event independently', async () => {
    await recordPurchase('hash-a', 'evt-1', 4, ctx.deps);
    await recordPurchase('hash-b', 'evt-1', 2, ctx.deps);
    await recordPurchase('hash-c', 'evt-1', 1, ctx.deps);

    const rA = await hasReachedPurchaseLimit('hash-a', 'evt-1', 4, ctx.deps);
    const rB = await hasReachedPurchaseLimit('hash-b', 'evt-1', 4, ctx.deps);
    const rC = await hasReachedPurchaseLimit('hash-c', 'evt-1', 4, ctx.deps);

    expect(rA.reached).toBe(true);
    expect(rB.reached).toBe(false);
    expect(rC.reached).toBe(false);
    expect(rA.currentCount).toBe(4);
    expect(rB.currentCount).toBe(2);
    expect(rC.currentCount).toBe(1);
  });

  it('handles many small purchases accumulating to the limit', async () => {
    // 4 separate single-ticket purchases
    await recordPurchase('h1', 'evt-1', 1, ctx.deps);
    await recordPurchase('h1', 'evt-1', 1, ctx.deps);
    await recordPurchase('h1', 'evt-1', 1, ctx.deps);
    await recordPurchase('h1', 'evt-1', 1, ctx.deps);

    const r = await hasReachedPurchaseLimit('h1', 'evt-1', 4, ctx.deps);
    expect(r).toEqual({ reached: true, currentCount: 4 });
  });

  it('does not cross-contaminate between events for same identity', async () => {
    await recordPurchase('h1', 'evt-1', 4, ctx.deps);
    await recordPurchase('h1', 'evt-2', 1, ctx.deps);

    const r1 = await hasReachedPurchaseLimit('h1', 'evt-1', 4, ctx.deps);
    const r2 = await hasReachedPurchaseLimit('h1', 'evt-2', 4, ctx.deps);

    expect(r1).toEqual({ reached: true, currentCount: 4 });
    expect(r2).toEqual({ reached: false, currentCount: 1 });
  });
});
