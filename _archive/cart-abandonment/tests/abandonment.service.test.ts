import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processAbandonedCarts,
  markCartConverted,
  getAbandonmentStats,
} from '../src/services/abandonment.service.js';
import {
  abandonStage1Email,
  abandonStage2Email,
  abandonStage3Email,
} from '../src/lib/email-templates.js';

// withTenantContext mock — předá db rovnou do callbacku
vi.mock('@tixly/rls-multitenancy', () => ({
  withTenantContext: async (db: any, _ctx: any, fn: any) => fn(db),
}));

process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
process.env.NEXT_PUBLIC_APP_URL = 'https://tixly.cz';

const NOW = new Date('2026-06-01T12:00:00Z');

function baseRow(overrides: Partial<any> = {}) {
  return {
    id: 'cart_1',
    user_id: 'user_1',
    event_id: 'evt_1',
    items: [
      { ticketTypeId: 't1', ticketTypeName: 'VIP', quantity: 2, unitPrice: 50000 },
    ],
    total_amount: 100000,
    ab_variant: 'A' as const,
    user_email: 'fan@example.com',
    user_first_name: 'Jana',
    event_name: 'Testovací festival',
    event_start_at: new Date('2026-06-10T18:00:00Z'),
    stop_marketing: false,
    ...overrides,
  };
}

function makeDeps(opts: { stage1Rows?: any[]; stage2Rows?: any[]; stage3Rows?: any[]; claimRowCount?: number } = {}) {
  const stage1Rows = opts.stage1Rows ?? [];
  const stage2Rows = opts.stage2Rows ?? [];
  const stage3Rows = opts.stage3Rows ?? [];
  const rowCount = opts.claimRowCount ?? 1;

  const query = vi.fn()
    .mockResolvedValueOnce(stage1Rows)
    .mockResolvedValueOnce(stage2Rows)
    .mockResolvedValueOnce(stage3Rows);

  const execute = vi.fn().mockResolvedValue({ rowCount });

  return {
    db: { query, execute, transaction: vi.fn() },
    email: { send: vi.fn().mockResolvedValue(undefined) },
    kafka: { send: vi.fn().mockResolvedValue(undefined) },
  };
}

// ---------------------------------------------------------------------------
// processAbandonedCarts
// ---------------------------------------------------------------------------
describe('processAbandonedCarts() — sekvenční kampaň', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Stage 1: odesílá email 30 min po opuštění', async () => {
    const deps = makeDeps({ stage1Rows: [baseRow()] });
    const result = await processAbandonedCarts(NOW, deps as any);
    expect(result.stage1).toBe(1);
    expect(deps.email.send).toHaveBeenCalledTimes(1);
    const [, subject] = deps.email.send.mock.calls[0]!;
    expect(subject).toContain('Zapomněl');
  });

  it('Stage 2: odesílá email 24h po Stage 1', async () => {
    const deps = makeDeps({ stage2Rows: [baseRow()] });
    const result = await processAbandonedCarts(NOW, deps as any);
    expect(result.stage2).toBe(1);
    const [, subject] = deps.email.send.mock.calls[0]!;
    expect(subject.toLowerCase()).toContain('zájem');
  });

  it('Stage 3: odesílá email 72h po Stage 2 se slevovým kódem', async () => {
    const deps = makeDeps({ stage3Rows: [baseRow()] });
    const result = await processAbandonedCarts(NOW, deps as any);
    expect(result.stage3).toBe(1);
    const [, subject, html] = deps.email.send.mock.calls[0]!;
    expect(subject).toContain('10');
    expect(html).toContain('CART-');
    // Stage3 volá 2x execute: claim + insert discount code
    const inserts = (deps.db.execute as any).mock.calls.filter((c: any[]) =>
      String(c[0]).includes('discount_codes'),
    );
    expect(inserts.length).toBe(1);
  });

  it('nepřepíše již odeslaný stage (idempotence) — claim vrátí rowCount=0', async () => {
    const deps = makeDeps({ stage1Rows: [baseRow()], claimRowCount: 0 });
    const result = await processAbandonedCarts(NOW, deps as any);
    expect(result.stage1).toBe(0);
    expect(deps.email.send).not.toHaveBeenCalled();
  });

  it('stop-on-unsubscribe: SQL WHERE vylučuje stop_marketing', async () => {
    const deps = makeDeps({ stage1Rows: [] });
    await processAbandonedCarts(NOW, deps as any);
    const sql = (deps.db.query as any).mock.calls[0]![0] as string;
    expect(sql).toMatch(/stop_marketing/);
  });

  it('stop-on-conversion: UPDATE obsahuje status <> converted', async () => {
    const deps = makeDeps({ stage1Rows: [baseRow()] });
    await processAbandonedCarts(NOW, deps as any);
    const updateSql = (deps.db.execute as any).mock.calls[0]![0] as string;
    expect(updateSql).toMatch(/status\s*<>\s*'converted'/);
  });

  it('SQL timing: stage1=30min, stage2=24h, stage3=72h', async () => {
    const deps = makeDeps();
    await processAbandonedCarts(NOW, deps as any);
    const [s1, s2, s3] = (deps.db.query as any).mock.calls.map((c: any[]) => c[0] as string);
    expect(s1).toContain("INTERVAL '30 minutes'");
    expect(s2).toContain("INTERVAL '24 hours'");
    expect(s3).toContain("INTERVAL '72 hours'");
  });

  it('prázdný input: vrátí nuly', async () => {
    const deps = makeDeps();
    const result = await processAbandonedCarts(NOW, deps as any);
    expect(result).toEqual({ stage1: 0, stage2: 0, stage3: 0 });
  });
});

// ---------------------------------------------------------------------------
// markCartConverted
// ---------------------------------------------------------------------------
describe('markCartConverted()', () => {
  it('nastaví status=converted a emituje event', async () => {
    const deps = makeDeps();
    await markCartConverted('cart_xyz', deps as any);
    const sql = (deps.db.execute as any).mock.calls[0]![0] as string;
    expect(sql).toContain("status = 'converted'");
    expect(deps.kafka.send).toHaveBeenCalledWith(
      'tixly.cart.converted',
      expect.objectContaining({ cartId: 'cart_xyz' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Email templates — render & Czech diacritics
// ---------------------------------------------------------------------------
describe('email templates', () => {
  const ctx = { firstName: 'Žofie', itemSummary: '2× Lóže přízemí', recoveryUrl: 'https://x.cz/r?t=a' };

  it('Stage 1 render zachová české znaky', () => {
    const { subject, html } = abandonStage1Email(ctx);
    expect(subject).toContain('Zapomněl');
    expect(html).toContain('Žofie');
    expect(html).toContain('Lóže přízemí');
    expect(html).toContain(ctx.recoveryUrl);
  });

  it('Stage 2 render má urgency variant když event brzy', () => {
    const a = abandonStage2Email({ ...ctx, eventStartingSoon: true });
    const b = abandonStage2Email({ ...ctx, eventStartingSoon: false });
    expect(a.html).toContain('vyprodány');
    expect(b.html).not.toContain('vyprodány');
  });

  it('Stage 3 render obsahuje slevový kód a procenta', () => {
    const { subject, html } = abandonStage3Email({
      ...ctx, discountCode: 'CART-ABCD1234', discountPct: 10,
    });
    expect(subject).toContain('10');
    expect(html).toContain('CART-ABCD1234');
    expect(html).toContain('10');
  });

  it('escapuje HTML ve jménu a items', () => {
    const { html } = abandonStage1Email({
      firstName: '<script>', itemSummary: 'a&b', recoveryUrl: 'https://x',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&amp;b');
  });
});

// ---------------------------------------------------------------------------
// getAbandonmentStats — beze změny
// ---------------------------------------------------------------------------
describe('getAbandonmentStats()', () => {
  it('vrátí recoveryRate per variant', async () => {
    const deps = {
      db: {
        query: vi.fn().mockResolvedValue([
          { ab_variant: 'A', abandoned: 10, recovered: 3, converted: 2 },
          { ab_variant: 'B', abandoned: 8, recovered: 1, converted: 0 },
        ]),
        execute: vi.fn(),
        transaction: vi.fn(),
      },
      email: { send: vi.fn() },
      kafka: { send: vi.fn() },
    };
    const stats = await getAbandonmentStats(deps as any, 'evt_1');
    expect(stats).toHaveLength(2);
    expect(stats[0]!.recoveryRate).toBe(30);
    expect(stats[1]!.recoveryRate).toBe(13);
  });
});
