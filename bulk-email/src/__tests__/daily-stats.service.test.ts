import { describe, it, expect, vi } from 'vitest';
import {
  subscribeDailyStats,
  unsubscribeDailyStats,
  gatherDailyStats,
  formatStatsEmail,
  sendDailyStats,
} from '../services/daily-stats.service.js';
import type { DbAdapter, EmailSender } from '../services/daily-stats.service.js';

function makeSubRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-001',
    promoter_id: 'promoter-001',
    email: 'promoter@example.cz',
    send_hour_utc: 7,
    include_zero_sales: true,
    is_active: true,
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
  };
}

function makeEmailSender(): EmailSender {
  return { send: vi.fn(async () => undefined) };
}

describe('subscribeDailyStats', () => {
  it('přihlásí promotéra k dennímu přehledu', async () => {
    const db = makeDb([[makeSubRow()]]);
    const result = await subscribeDailyStats({
      promoterId: 'promoter-001',
      email: 'promoter@example.cz',
      sendHourUtc: 7,
    }, db);

    expect(result.email).toBe('promoter@example.cz');
    expect(result.sendHourUtc).toBe(7);
    expect(result.isActive).toBe(true);
  });

  it('odmítne neplatný email', async () => {
    const db = makeDb();
    await expect(subscribeDailyStats({
      promoterId: 'p', email: 'not-email', sendHourUtc: 7,
    }, db)).rejects.toThrow('invalid email');
  });

  it('odmítne sendHourUtc mimo rozsah', async () => {
    const db = makeDb();
    await expect(subscribeDailyStats({
      promoterId: 'p', email: 'a@b.cz', sendHourUtc: 25,
    }, db)).rejects.toThrow('sendHourUtc must be 0–23');
  });

  it('upsertuje — aktualizuje existující subscription', async () => {
    const db = makeDb([[makeSubRow({ email: 'new@email.cz' })]]);
    await subscribeDailyStats({ promoterId: 'promoter-001', email: 'new@email.cz' }, db);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });
});

describe('unsubscribeDailyStats', () => {
  it('odhlásí promotéra', async () => {
    const db = makeDb([], vi.fn());
    await unsubscribeDailyStats('promoter-001', db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('is_active = false');
  });
});

describe('gatherDailyStats', () => {
  it('shromáždí statistiky prodejů za den', async () => {
    const db = makeDb([[
      { event_id: 'evt-001', event_name: 'Rockový festival', tickets_sold: '42', revenue_hellers: '2100000' },
      { event_id: 'evt-002', event_name: 'Stand-up comedy', tickets_sold: '0', revenue_hellers: '0' },
    ]]);

    const result = await gatherDailyStats('promoter-001', '2026-04-14', db);
    expect(result.totalTicketsSold).toBe(42);
    expect(result.totalRevenueHellers).toBe(2100000);
    expect(result.eventStats).toHaveLength(2);
    expect(result.eventStats[1].ticketsSold).toBe(0);
  });

  it('vrátí nuly pro den bez prodejů', async () => {
    const db = makeDb([[]]); // empty
    const result = await gatherDailyStats('promoter-001', '2026-04-14', db);
    expect(result.totalTicketsSold).toBe(0);
    expect(result.eventStats).toHaveLength(0);
  });
});

describe('formatStatsEmail', () => {
  it('vygeneruje HTML email se správným předmětem', () => {
    const summary = {
      promoterId: 'promoter-001',
      periodDate: '2026-04-14',
      totalTicketsSold: 42,
      totalRevenueHellers: 2100000,
      eventStats: [
        { eventId: 'evt-001', eventName: 'Rockový festival', ticketsSold: 42, revenueHellers: 2100000 },
      ],
    };

    const { subject, htmlBody } = formatStatsEmail(summary);
    expect(subject).toContain('42 vstupenek');
    expect(subject).toContain('2026-04-14');
    expect(htmlBody).toContain('Rockový festival');
    expect(htmlBody).toContain('21000.00 Kč');
  });

  it('označí akce s nulovým prodejem upozorněním', () => {
    const summary = {
      promoterId: 'promoter-001',
      periodDate: '2026-04-14',
      totalTicketsSold: 0,
      totalRevenueHellers: 0,
      eventStats: [
        { eventId: 'evt-002', eventName: 'Nová akce', ticketsSold: 0, revenueHellers: 0 },
      ],
    };

    const { htmlBody } = formatStatsEmail(summary);
    expect(htmlBody).toContain('⚠️');
  });
});

describe('sendDailyStats', () => {
  it('odešle denní přehled přihlášenému promotérovi', async () => {
    const statsRows = [
      { event_id: 'evt-001', event_name: 'Festival', tickets_sold: '10', revenue_hellers: '500000' },
    ];
    const db = makeDb([
      [makeSubRow()],   // subscription
      statsRows,        // gather stats
    ]);
    const email = makeEmailSender();

    await sendDailyStats('promoter-001', '2026-04-14', email, db);

    expect(email.send).toHaveBeenCalledOnce();
    const [to, subject] = (email.send as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string, string];
    expect(to).toBe('promoter@example.cz');
    expect(subject).toContain('10 vstupenek');
    expect(db.execute).toHaveBeenCalledOnce(); // log sent
  });

  it('přeskočí odesílání pokud promotér není přihlášen', async () => {
    const db = makeDb([[]]); // no subscription
    const email = makeEmailSender();
    await sendDailyStats('promoter-001', '2026-04-14', email, db);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('přeskočí odesílání pro nulové prodeje pokud include_zero_sales=false', async () => {
    const db = makeDb([
      [makeSubRow({ include_zero_sales: false })],
      [],  // no events with sales
    ]);
    const email = makeEmailSender();
    await sendDailyStats('promoter-001', '2026-04-14', email, db);
    expect(email.send).not.toHaveBeenCalled();
    const logSql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(logSql).toContain("'skipped'");
  });

  it('zaloguje chybu při selhání odeslání emailu', async () => {
    const db = makeDb([
      [makeSubRow()],
      [{ event_id: 'e', event_name: 'E', tickets_sold: '5', revenue_hellers: '50000' }],
    ]);
    const email: EmailSender = {
      send: vi.fn(async () => { throw new Error('SMTP_ERROR'); }),
    };

    await expect(sendDailyStats('promoter-001', '2026-04-14', email, db)).rejects.toThrow('SMTP_ERROR');
    const logSql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(logSql).toContain("'failed'");
  });
});
