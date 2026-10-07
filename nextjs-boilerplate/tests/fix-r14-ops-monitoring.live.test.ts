// @vitest-environment node
/**
 * Kolo 14 / krok 3 — hlídání provozu (DB z migrací, handlery pod tixly_app, e-mail = Mailpit):
 *   - heartbeat cronů: dispatcher zapíše čas posledního ÚSPĚŠNÉHO běhu; kontrolní job (15 min) pošle e-mail na
 *     PLATFORM_ADMIN_EMAIL, když cron neproběhl déle než 2× svůj interval;
 *   - upozornění (nejvýš 1 e-mail za 30 min na stejný problém): selhání webhooku brány, zaplaceno u brány bez vstupenek
 *     po 10 min, selhání e-mailu se vstupenkami, refund ve stavu refund_failed, selhání zálohy;
 *   - denní souhrn v 7:00 Europe/Prague: prodeje a tržba za včerejšek po termínech, propadlé rezervace, neodeslané
 *     e-maily, nevyřízené refundy, chyby.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

// e-mail se vstupenkami selže (jen ten) — ostatní e-maily (upozornění) projdou do Mailpitu
vi.mock('@/lib/email/mailer', async (orig) => {
  const actual = await orig<typeof import('@/lib/email/mailer')>();
  return {
    ...actual,
    sendMail: async (m: Parameters<typeof actual.sendMail>[0]) => {
      if (String(m.subject ?? '').includes('vstupenky na') && String(m.to).includes('mailfail')) throw new Error('SMTP 421 simulace výpadku');
      return actual.sendMail(m);
    },
  };
});

const run = describe.skipIf(!hasLocalDb);
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:58225';
const RUN = Date.now().toString(36);
const ADMIN = `ops-${RUN}@tixly.fix`;

interface MailMsg { ID: string; Subject: string }
async function mails(subjectPart: string): Promise<MailMsg[]> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${ADMIN}`)}&limit=200`);
  const j = (await r.json()) as { messages: MailMsg[] };
  return j.messages.filter((m) => m.Subject.includes(subjectPart));
}
async function waitMails(subjectPart: string, n: number): Promise<MailMsg[]> {
  for (let i = 0; i < 30; i++) {
    const m = await mails(subjectPart);
    if (m.length >= n) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 400));
  return mails(subjectPart);
}
async function body(id: string): Promise<string> {
  const r = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  return ((await r.json()) as { Text: string }).Text;
}
const internal = (path: string, payload: unknown = {}) => new Request(`http://localhost${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN! }, body: JSON.stringify(payload),
}) as unknown as NextRequest;

describe('cron-schedule: interval z výrazu cronu (nejdelší mezera mezi běhy, UTC)', () => {
  it.each([
    ['*/5 * * * *', 5], ['*/15 * * * *', 15], ['0 * * * *', 60], ['0 */6 * * *', 360], ['0 8 * * *', 1440],
    ['0 7 * * 1', 10080], ['*/50 * * * *', 50], ['0 1 1 * *', 31 * 1440], ['0 5,6 * * *', 23 * 60],
  ])('%s → %i min', async (expr, minutes) => {
    const { cronIntervalMinutes } = await import('@/lib/ops/cron-schedule');
    expect(cronIntervalMinutes(expr as string)).toBe(minutes);
  });
  it('registr obsahuje všechny crony z vercel.json + týdenní zálohu DB', async () => {
    const { cronRegistry } = await import('@/lib/ops/cron-schedule');
    const reg = cronRegistry();
    for (const j of ['expire-pending-orders', 'release-expired-seat-holds', 'seat-reservations', 'ops-watchdog', 'ops-daily-summary', 'lastminute-check', 'db-backup']) {
      expect(reg.find((r) => r.job === j), j).toBeTruthy();
    }
    expect(reg.find((r) => r.job === 'ops-watchdog')!.intervalMinutes).toBe(15);
    expect(reg.find((r) => r.job === 'db-backup')!.intervalMinutes).toBe(7 * 1440);
  });
});

run('Kolo 14 / krok 3 — hlídání provozu', () => {
  let clone: LocalClone;
  beforeAll(async () => {
    clone = await createLocalClone();
    process.env.PLATFORM_ADMIN_EMAIL = ADMIN;
    // čistý stav upozornění (sdílená DB testů)
    await clone.pool.query(`DELETE FROM monitoring.ops_alerts`);
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('dispatcher zapíše heartbeat jen po úspěšném běhu jobu; neúspěch = poslední stav a chyba', async () => {
    const { GET } = await import('@/app/api/cron/dispatch/route');
    const realFetch = globalThis.fetch;
    const call = async (innerStatus: number) => {
      vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => (String(url).includes('/api/internal/cron/')
        ? new Response(JSON.stringify({ ok: innerStatus < 400 }), { status: innerStatus, headers: { 'content-type': 'application/json' } })
        : realFetch(url, init)));
      try {
        return await GET(new NextRequest('http://localhost/api/cron/dispatch?job=send-reminders', { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
      } finally { vi.unstubAllGlobals(); }
    };
    expect((await call(200)).status).toBe(200);
    const ok = (await clone.pool.query(`SELECT last_success_at, last_status FROM monitoring.cron_heartbeats WHERE job = 'send-reminders'`)).rows[0];
    expect(Date.now() - new Date(ok.last_success_at).getTime()).toBeLessThan(10_000);
    expect(ok.last_status).toBe(200);
    await clone.pool.query(`UPDATE monitoring.cron_heartbeats SET last_success_at = now() - interval '1 hour' WHERE job = 'send-reminders'`);
    const r = await call(500);
    expect(r.status).toBe(502); // dispatcher hlásí selhání jobu i Vercelu (dřív 200 s chybou v těle)
    const bad = (await clone.pool.query(`SELECT last_success_at, last_status, last_error FROM monitoring.cron_heartbeats WHERE job = 'send-reminders'`)).rows[0];
    expect(Date.now() - new Date(bad.last_success_at).getTime()).toBeGreaterThan(50 * 60_000);
    expect(bad.last_status).toBe(500);
    expect(String(bad.last_error)).not.toBe('');
  });

  it('kontrolní job: cron neproběhl > 2× interval → e-mail; do 30 min stejný problém znovu neposílá', async () => {
    const { POST } = await import('@/app/api/internal/cron/ops-watchdog/route');
    await clone.pool.query(
      `INSERT INTO monitoring.cron_heartbeats (job, interval_minutes, registered_at, last_success_at) VALUES ('expire-pending-orders', 5, now() - interval '1 day', now() - interval '11 minutes')
       ON CONFLICT (job) DO UPDATE SET last_success_at = EXCLUDED.last_success_at, registered_at = EXCLUDED.registered_at`,
    );
    await clone.pool.query(
      `INSERT INTO monitoring.cron_heartbeats (job, interval_minutes, registered_at, last_success_at) VALUES ('release-expired-seat-holds', 5, now() - interval '1 day', now() - interval '6 minutes')
       ON CONFLICT (job) DO UPDATE SET last_success_at = EXCLUDED.last_success_at, registered_at = EXCLUDED.registered_at`,
    );
    expect((await POST(internal('/api/internal/cron/ops-watchdog'))).status).toBe(200);
    const m = await waitMails('expire-pending-orders', 1);
    expect(m).toHaveLength(1);
    expect(await mails('release-expired-seat-holds')).toHaveLength(0); // 6 min < 2 × 5 min
    expect(await body(m[0].ID)).toMatch(/neproběhl/);
    expect((await POST(internal('/api/internal/cron/ops-watchdog'))).status).toBe(200);
    expect(await waitMails('expire-pending-orders', 2)).toHaveLength(1); // omezení 1 / 30 min
  });

  it('zaplaceno u brány, ale bez vstupenek po 10 min → e-mail (čerstvě zaplacené ne)', async () => {
    const { POST } = await import('@/app/api/internal/cron/ops-watchdog/route');
    const c = await clone.seed.chain({ basePrice: 20000, remainingQty: 10 });
    const late = await clone.seed.order(c, { status: 'paid', unitPrice: 20000 });
    const fresh = await clone.seed.order(c, { status: 'paid', unitPrice: 20000 });
    await clone.pool.query(`DELETE FROM monitoring.ops_alerts WHERE key = 'paid_without_tickets'`); // limit z předchozích běhů
    const before = (await mails('bez vstupenek')).length;
    await clone.pool.query(`UPDATE orders.orders SET paid_at = now() - interval '11 minutes', payment_provider = 'gopay' WHERE id = $1`, [late.orderId]);
    await clone.pool.query(`UPDATE orders.orders SET paid_at = now() - interval '2 minutes', payment_provider = 'gopay' WHERE id = $1`, [fresh.orderId]);
    expect((await POST(internal('/api/internal/cron/ops-watchdog'))).status).toBe(200);
    const m = await waitMails('bez vstupenek', before + 1);
    expect(m).toHaveLength(before + 1);
    const text = await body(m[0].ID); // nejnovější
    expect(text).toContain(late.orderId);
    expect(text).not.toContain(fresh.orderId);
  });

  it('refund ve stavu refund_failed → e-mail', async () => {
    const { POST } = await import('@/app/api/internal/cron/ops-watchdog/route');
    const c = await clone.seed.chain({ basePrice: 20000, remainingQty: 10 });
    const o = await clone.seed.order(c, { status: 'refund_failed', unitPrice: 20000 });
    await clone.pool.query(`DELETE FROM monitoring.ops_alerts WHERE key = 'refund_failed'`);
    const before = (await mails('refund_failed')).length;
    expect((await POST(internal('/api/internal/cron/ops-watchdog'))).status).toBe(200);
    const m = await waitMails('refund_failed', before + 1);
    expect(m).toHaveLength(before + 1);
    expect(await body(m[0].ID)).toContain(o.orderId);
  });

  it('selhání webhooku brány → e-mail', async () => {
    const { GET } = await import('@/app/api/payments/gopay/webhook/route');
    const res = await GET(new Request('http://localhost/api/payments/gopay/webhook?id=999999999001') as unknown as NextRequest);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const m = await waitMails('webhook', 1);
    expect(m).toHaveLength(1);
    expect(await body(m[0].ID)).toContain('999999999001');
  });

  it('selhání e-mailu se vstupenkami → e-mail provozu', async () => {
    const c = await clone.seed.chain({ basePrice: 20000, remainingQty: 10 });
    const buyer = await clone.seed.user(`mailfail`); // e-mail obsahuje „mailfail" → simulovaný výpadek SMTP jen pro tento nákup
    const o = await clone.seed.order(c, { status: 'paid', unitPrice: 20000, userId: buyer.id });
    const { POST } = await import('@/app/api/internal/order-completed/route');
    const r = await POST(internal('/api/internal/order-completed', { orderId: o.orderId }));
    expect(r.status).toBe(200);
    const m = await waitMails('e-mail se vstupenkami', 1);
    expect(m).toHaveLength(1);
    expect(await body(m[0].ID)).toContain(o.orderId);
  });

  it('záloha: selhání → e-mail; úspěch → heartbeat db-backup; bez tajemství 403', async () => {
    const { POST } = await import('@/app/api/ops/backup-status/route');
    const req = (b: unknown, auth = true) => new Request('http://localhost/api/ops/backup-status', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {}) }, body: JSON.stringify(b),
    }) as unknown as NextRequest;
    expect((await POST(req({ status: 'failure' }, false))).status).toBe(403);
    expect((await POST(req({ status: 'failure', runUrl: 'https://github.com/x/y/actions/runs/1' }))).status).toBe(200);
    const m = await waitMails('záloh', 1);
    expect(m).toHaveLength(1);
    expect((await POST(req({ status: 'success' }))).status).toBe(200);
    const hb = (await clone.pool.query(`SELECT last_success_at FROM monitoring.cron_heartbeats WHERE job = 'db-backup'`)).rows[0];
    expect(Date.now() - new Date(hb.last_success_at).getTime()).toBeLessThan(10_000);
  });

  it('denní souhrn v 7:00 Europe/Prague: včerejší prodeje po termínech; jednou za den; mimo 7:00 nic', async () => {
    const { POST } = await import('@/app/api/internal/cron/ops-daily-summary/route');
    const c = await clone.seed.chain({ basePrice: 35000, remainingQty: 10 });
    const o = await clone.seed.order(c, { status: 'paid', unitPrice: 35000, quantity: 2 });
    // dnešek v Praze 07:05 → včerejšek = den před tím; objednávka zaplacená včera ve 12:00 pražského času
    const now = new Date();
    const pragueToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(now); // YYYY-MM-DD
    const at = await clone.pool.query(`SELECT ((($1::date)::timestamp + time '07:05') AT TIME ZONE 'Europe/Prague') AS at,
                                              ((($1::date - 1)::timestamp + time '12:00') AT TIME ZONE 'Europe/Prague') AS paid`, [pragueToday]);
    await clone.pool.query(`UPDATE orders.orders SET paid_at = $2 WHERE id = $1`, [o.orderId, at.rows[0].paid]);
    const title = (await clone.pool.query(`SELECT title FROM catalog.events WHERE id = $1`, [c.eventId])).rows[0].title as string;
    const skip = await POST(internal('/api/internal/cron/ops-daily-summary', { at: new Date(new Date(at.rows[0].at).getTime() + 3600_000).toISOString() }));
    expect(((await skip.json()) as { skipped?: string }).skipped).toBeTruthy(); // 8:05 Praha — ne
    const r = await POST(internal('/api/internal/cron/ops-daily-summary', { at: new Date(at.rows[0].at).toISOString() }));
    expect(r.status).toBe(200);
    const m = await waitMails('Denní souhrn', 1);
    expect(m).toHaveLength(1);
    const text = await body(m[0].ID);
    expect(text).toContain(title);
    expect(text).toMatch(/700[\s ]Kč/); // 2 × 350 Kč
    for (const sekce of ['Propadlé rezervace', 'Neodeslané e-maily', 'Nevyřízené refundy', 'Chyby']) expect(text).toContain(sekce);
    await POST(internal('/api/internal/cron/ops-daily-summary', { at: new Date(at.rows[0].at).toISOString() }));
    expect(await waitMails('Denní souhrn', 2)).toHaveLength(1); // jednou za den
  });
});
