// funnel.service.test.ts — 10+ testů pro service vrstvu

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  trackStep,
  getFunnelReport,
  getSessionPath,
  DbAdapter,
  KafkaAdapter,
  ServiceDeps,
} from '../src/services/funnel.service';
import { FUNNEL_STEPS } from '../src/types/funnel.types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDeps(overrides?: {
  dbQuery?: DbAdapter['query'];
  dbExecute?: DbAdapter['execute'];
  kafkaSend?: KafkaAdapter['send'];
}): ServiceDeps {
  const db: DbAdapter = {
    query: overrides?.dbQuery ?? vi.fn().mockResolvedValue([]),
    execute: overrides?.dbExecute ?? vi.fn().mockResolvedValue(undefined),
  };
  const kafka: KafkaAdapter = {
    send: overrides?.kafkaSend ?? vi.fn().mockResolvedValue(undefined),
  };
  return { db, kafka };
}

/** Čeká až se fire-and-forget promise dokončí v event loop */
const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ─── trackStep ───────────────────────────────────────────────────────────────

describe('trackStep', () => {
  it('vrátí okamžitě (fire-and-forget) — není Promise', () => {
    const deps = makeDeps();
    const result = trackStep(deps, {
      sessionId: 'sess-1',
      eventId: '00000000-0000-0000-0000-000000000001',
      step: 'view',
    });
    expect(result).toBeUndefined();
  });

  it('zapíše do DB po dokončení event loop', async () => {
    const dbExecute = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ dbExecute });
    trackStep(deps, {
      sessionId: 'sess-2',
      eventId: '00000000-0000-0000-0000-000000000001',
      step: 'cart',
    });
    await flushPromises();
    expect(dbExecute).toHaveBeenCalledOnce();
    const [sql, params] = dbExecute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('analytics.funnel_events');
    expect(params).toContain('sess-2');
    expect(params).toContain('cart');
  });

  it('odešle Kafka event na správný topic', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ kafkaSend });
    trackStep(deps, {
      sessionId: 'sess-3',
      eventId: '00000000-0000-0000-0000-000000000002',
      step: 'checkout',
    });
    await flushPromises();
    expect(kafkaSend).toHaveBeenCalledWith(
      'tixly.funnel.step-tracked',
      expect.objectContaining({ step: 'checkout', sessionId: 'sess-3' }),
    );
  });

  it('Kafka payload obsahuje userId = null pro anonymního uživatele', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ kafkaSend });
    trackStep(deps, {
      sessionId: 'anon-sess',
      eventId: '00000000-0000-0000-0000-000000000003',
      step: 'view',
      // userId nepředáno
    });
    await flushPromises();
    expect(kafkaSend).toHaveBeenCalledWith(
      'tixly.funnel.step-tracked',
      expect.objectContaining({ userId: null }),
    );
  });

  it('chyba v DB nerozbije volající kód (fire-and-forget)', async () => {
    const dbExecute = vi.fn().mockRejectedValue(new Error('DB down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ dbExecute });

    expect(() => {
      trackStep(deps, {
        sessionId: 'sess-err',
        eventId: '00000000-0000-0000-0000-000000000001',
        step: 'paid',
      });
    }).not.toThrow();

    await flushPromises();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[funnel]'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('chyba v Kafka nerozbije volající kód', async () => {
    const kafkaSend = vi.fn().mockRejectedValue(new Error('Kafka down'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps({ kafkaSend });

    trackStep(deps, {
      sessionId: 'sess-kafka-err',
      eventId: '00000000-0000-0000-0000-000000000001',
      step: 'ticket_issued',
    });

    await flushPromises();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('metadata jsou předána do DB a Kafka', async () => {
    const kafkaSend = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ kafkaSend });
    const metadata = { ticketType: 'VIP', price: 150 };
    trackStep(deps, {
      sessionId: 'sess-meta',
      eventId: '00000000-0000-0000-0000-000000000001',
      step: 'cart',
      metadata,
    });
    await flushPromises();
    expect(kafkaSend).toHaveBeenCalledWith(
      'tixly.funnel.step-tracked',
      expect.objectContaining({ metadata }),
    );
  });
});

// ─── getFunnelReport ──────────────────────────────────────────────────────────

describe('getFunnelReport', () => {
  it('vrátí FunnelReport s eventId a period', async () => {
    const deps = makeDeps();
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-31T23:59:59Z');
    const report = await getFunnelReport(deps, 'promo-1', 'evt-1', from, to);
    expect(report.eventId).toBe('evt-1');
    expect(report.period.from).toEqual(from);
    expect(report.period.to).toEqual(to);
  });

  it('vrátí 5 kroků ve správném pořadí', async () => {
    const deps = makeDeps();
    const report = await getFunnelReport(
      deps, 'promo-1', 'evt-1',
      new Date('2026-01-01'), new Date('2026-01-31'),
    );
    expect(report.steps).toHaveLength(5);
    expect(report.steps.map((s) => s.step)).toEqual(FUNNEL_STEPS);
  });

  it('overallConversionRate = 0 pokud db vrátí prázdné výsledky', async () => {
    const deps = makeDeps();
    const report = await getFunnelReport(
      deps, 'promo-1', 'evt-empty',
      new Date('2026-01-01'), new Date('2026-01-31'),
    );
    expect(report.overallConversionRate).toBe(0);
  });

  it('správně aggreguje DB data do step stats', async () => {
    const dbRows = [
      { step: 'view', count: '1000' },
      { step: 'cart', count: '800' },
      { step: 'ticket_issued', count: '100' },
    ];
    const deps = makeDeps({ dbQuery: vi.fn().mockResolvedValue(dbRows) });
    const report = await getFunnelReport(
      deps, 'promo-1', 'evt-2',
      new Date('2026-01-01'), new Date('2026-01-31'),
    );
    const view = report.steps.find((s) => s.step === 'view')!;
    expect(view.count).toBe(1000);
    const cart = report.steps.find((s) => s.step === 'cart')!;
    expect(cart.dropOffCount).toBe(200);
    expect(report.overallConversionRate).toBe(10);
  });
});

// ─── getSessionPath ───────────────────────────────────────────────────────────

describe('getSessionPath', () => {
  it('vrátí prázdné pole pokud session neexistuje', async () => {
    const deps = makeDeps();
    const path = await getSessionPath(deps, 'nonexistent-session');
    expect(path).toEqual([]);
  });

  it('mapuje DB řádky na FunnelEvent objekty', async () => {
    const now = new Date('2026-01-15T10:00:00Z');
    const dbRows = [
      {
        id: 'fe-1',
        session_id: 'sess-path',
        user_id: null,
        event_id: 'evt-1',
        step: 'view',
        metadata: {},
        created_at: now,
      },
      {
        id: 'fe-2',
        session_id: 'sess-path',
        user_id: null,
        event_id: 'evt-1',
        step: 'cart',
        metadata: { ticketType: 'GA' },
        created_at: new Date(now.getTime() + 5000),
      },
    ];
    const deps = makeDeps({ dbQuery: vi.fn().mockResolvedValue(dbRows) });
    const path = await getSessionPath(deps, 'sess-path');
    expect(path).toHaveLength(2);
    expect(path[0].step).toBe('view');
    expect(path[1].step).toBe('cart');
    expect(path[1].metadata).toEqual({ ticketType: 'GA' });
  });

  it('userId je null pro anonymní session', async () => {
    const dbRows = [{
      id: 'fe-anon',
      session_id: 'anon-sess',
      user_id: null,
      event_id: 'evt-1',
      step: 'view',
      metadata: {},
      created_at: new Date(),
    }];
    const deps = makeDeps({ dbQuery: vi.fn().mockResolvedValue(dbRows) });
    const path = await getSessionPath(deps, 'anon-sess');
    expect(path[0].userId).toBeNull();
  });
});
