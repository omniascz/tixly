/**
 * wrapped-routes.live.test.ts — pozitivni cesta 9 rout obalenych kontextem
 * (§95, §99). Do ted mely tsc cisty a spravny kontext, ale NIKDY se neukazalo,
 * ze fungujou.
 *
 * KLICOVE ZJISTENI: seed se SDILET DA. `makeSeed().fullChain()` uz umi cely
 * retez promoter -> akce -> typ listku -> objednavka -> VYDANE LISTKY
 * (produkcni cestou pres issueTicketsForOrder). Vetsina z tech 9 rout na nem
 * stoji, takze to neni 9x vlastni retez.
 *
 * Dukazem jsou VYPSANA TELA ODPOVEDI, ne pocet zelenych testu — sada je flaky
 * (R-15), takze se na pass/fail nespoleha.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone, type Seed } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;
let seed: Seed;
let chain: Awaited<ReturnType<Seed['fullChain']>>;
let cizi: { id: string; email: string };

const call = async (mod: string, url: string, params: Record<string, string>, userId?: string) => {
  const m = await import(mod) as { GET: (r: never, c: never) => Promise<Response> };
  const headers: Record<string, string> = {};
  if (userId) headers['x-user-id'] = userId;
  const res = await m.GET(new NextRequest(url, { headers }) as never, { params } as never);
  return { status: res.status, body: (await res.text()).slice(0, 130) };
};

d('obalene routy — pozitivni cesta', () => {
  beforeAll(async () => {
    clone = await createLiveClone('wrapped-routes');
    seed = makeSeed(clone.pool);
    chain = await seed.fullChain();
    cizi = await seed.user('cizi');
    console.log('[seed] order=', chain.orderId, 'user=', chain.userId,
      'listku=', Array.isArray(chain.tickets) ? chain.tickets.length : '?');
  }, 240_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('my/orders/[id]/upgrade-options — vlastnik vs cizi', async () => {
    const mod = '@/app/api/my/orders/[id]/upgrade-options/route';
    const url = `http://localhost:3000/api/my/orders/${chain.orderId}/upgrade-options`;
    const own = await call(mod, url, { id: chain.orderId }, chain.userId);
    const foreign = await call(mod, url, { id: chain.orderId }, cizi.id);
    console.log('[upgrade-options] vlastnik', own.status, own.body);
    console.log('[upgrade-options] CIZI    ', foreign.status, foreign.body);
    expect(own.status).toBeLessThan(500);
  }, 120_000);

  it('my/tickets — vlastnik vidi svuj listek', async () => {
    const tid = Array.isArray(chain.tickets) && chain.tickets.length
      ? (chain.tickets[0] as { id?: string; ticketId?: string }).id
        ?? (chain.tickets[0] as { ticketId?: string }).ticketId
      : undefined;
    console.log('[tickets] prvni listek id =', tid);
    const r = await clone.pool.query(
      'SELECT count(*)::int AS n FROM tickets.tickets WHERE order_id = $1', [chain.orderId]);
    console.log('[tickets] vydano v DB =', r.rows[0].n);
    expect(r.rows[0].n).toBeGreaterThan(0);
  }, 120_000);

  it('platform/artists — platform admin kontext', async () => {
    const mod = '@/app/api/platform/artists/route';
    const out = await call(mod, 'http://localhost:3000/api/platform/artists', {});
    console.log('[platform/artists]', out.status, out.body);
    expect(out.status).toBeLessThan(500);
  }, 120_000);

  // ── platform-admin token ────────────────────────────────────────────────
  // Fixture ho neumi, ale vyrobit jde: platform-auth.ts overuje `jose` JWT
  // proti JWT_SECRET a chce `sub` + `roles.isPlatformAdmin`. Dev fallback
  // secretu je v kodu, takze test nepotrebuje zadnou env.
  const adminToken = async (userId: string) => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET ?? 'dev-secret-change-me-min-32-chars-please');
    return new SignJWT({ type: 'access', roles: { isPlatformAdmin: true } }) // kolo 3 K4d: access token nese typ
      .setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
      .setExpirationTime('1h').sign(secret);
  };

  it('platform/artists — s platform-admin tokenem (drive 403)', async () => {
    await clone.pool.query('UPDATE identity.users SET is_platform_admin = true WHERE id = $1',
      [chain.adminUserId]).catch((e) => console.log('admin flag:', e.code));
    const tok = await adminToken(chain.adminUserId);
    const { GET } = await import('@/app/api/platform/artists/route');
    const res = await GET(new NextRequest('http://localhost:3000/api/platform/artists',
      { headers: { authorization: `Bearer ${tok}` } }) as never);
    console.log('[platform/artists]', res.status, (await res.text()).slice(0, 110));
  }, 120_000);

  it('platform/postal — GET seznam s admin tokenem', async () => {
    const tok = await adminToken(chain.adminUserId);
    const { GET } = await import('@/app/api/platform/postal/route');
    const res = await GET(new NextRequest('http://localhost:3000/api/platform/postal',
      { headers: { authorization: `Bearer ${tok}` } }) as never);
    console.log('[platform/postal]', res.status, (await res.text()).slice(0, 110));
  }, 120_000);

  it('my/tickets/[ticketId]/transfer — GET vlastnik vs CIZI (izolace)', async () => {
    const t = await clone.pool.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1',
      [chain.orderId]);
    const tid = t.rows[0]?.id as string;
    const { GET } = await import('@/app/api/my/tickets/[ticketId]/transfer/route');
    const hit = async (uid: string) => {
      const r = await GET(new NextRequest(`http://localhost:3000/api/my/tickets/${tid}/transfer`,
        { headers: { 'x-user-id': uid } }) as never, { params: { ticketId: tid } } as never);
      return `${r.status} ${(await r.text()).slice(0, 70)}`;
    };
    console.log('[my/tickets/transfer] vlastnik', await hit(chain.userId));
    console.log('[my/tickets/transfer] CIZI    ', await hit(cizi.id));
  }, 120_000);

  it('cron/release-group-invite-holds — servisni kontext', async () => {
    process.env.INTERNAL_SERVICE_TOKEN = 'test-cron-secret';
    const { POST } = await import('@/app/api/internal/cron/release-group-invite-holds/route');
    const res = await POST(new NextRequest('http://localhost:3000/x',
      { method: 'POST', headers: { 'x-internal-token': 'test-cron-secret' } }) as never);
    console.log('[cron/release-group-invite-holds]', res.status, (await res.text()).slice(0, 110));
  }, 120_000);

  it('my/tickets/transfer POST -> tickets/transfer/[token] GET+POST', async () => {
    const t = await clone.pool.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1',
      [chain.orderId]);
    const tid = t.rows[0]?.id as string;
    // 1) vlastnik zalozi prevod
    const { POST: startTransfer } = await import('@/app/api/my/tickets/[ticketId]/transfer/route');
    const r1 = await startTransfer(new NextRequest(`http://localhost:3000/x`, {
      method: 'POST', headers: { 'x-user-id': chain.userId, 'content-type': 'application/json' },
      body: JSON.stringify({ toEmail: cizi.email }),
    }) as never, { params: { ticketId: tid } } as never);
    const b1 = await r1.text();
    console.log('[my/tickets/transfer POST]', r1.status, b1.slice(0, 110));
    const tok = await clone.pool.query(
      'SELECT transfer_token FROM orders.ticket_transfers WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 1', [tid]);
    const token = tok.rows[0]?.transfer_token as string | undefined;
    console.log('[transfer] token v DB =', token ? 'ANO' : 'NE');
    if (!token) return;
    // 2) GET je VEREJNY — prijemce jeste neni prihlaseny
    const { GET, POST } = await import('@/app/api/tickets/transfer/[token]/route');
    const g = await GET(new NextRequest(`http://localhost:3000/x`) as never,
      { params: { token } } as never);
    console.log('[transfer/token GET verejny]', g.status, (await g.text()).slice(0, 100));
    // 3) POST prijme prihlaseny prijemce
    const pr = await POST(new NextRequest(`http://localhost:3000/x`, {
      method: 'POST', headers: { 'x-user-id': cizi.id, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }) as never, { params: { token } } as never);
    console.log('[transfer/token POST prijemce]', pr.status, (await pr.text()).slice(0, 100));
  }, 180_000);

  it('platform/postal/[id] PATCH s admin tokenem', async () => {
    const tok = await adminToken(chain.adminUserId);
    const d = await clone.pool.query(
      `INSERT INTO orders.postal_deliveries
         (order_id, recipient_name, address_line1, city, postal_code, status)
       VALUES ($1,'Prijemce','Ulice 1','Praha','11000','pending') RETURNING id`,
      [chain.orderId]).catch((e) => { console.log('postal seed:', e.code, e.message.slice(0, 60)); return null; });
    if (!d) return;
    const id = d.rows[0].id as string;
    const { PATCH } = await import('@/app/api/platform/postal/[id]/route');
    const r = await PATCH(new NextRequest('http://localhost:3000/x', {
      method: 'PATCH', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'dispatched' }),
    }) as never, { params: { id } } as never);
    console.log('[platform/postal/[id] PATCH]', r.status, (await r.text()).slice(0, 110));
  }, 120_000);

  it('R-40 bisect: ktery JOIN zahazuje radek prevodu', async () => {
    const t = await clone.pool.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1',
      [chain.orderId]);
    const tid = t.rows[0]?.id as string;
    const { POST: startTransfer } = await import('@/app/api/my/tickets/[ticketId]/transfer/route');
    await startTransfer(new NextRequest('http://localhost:3000/x', {
      method: 'POST', headers: { 'x-user-id': chain.userId, 'content-type': 'application/json' },
      body: JSON.stringify({ toEmail: cizi.email }),
    }) as never, { params: { ticketId: tid } } as never);
    const tk = await clone.pool.query(
      'SELECT transfer_token FROM orders.ticket_transfers WHERE ticket_id=$1 ORDER BY created_at DESC LIMIT 1', [tid]);
    const token = tk.rows[0]?.transfer_token as string;
    const steps: Array<[string, string]> = [
      ['1 jen ticket_transfers', 'FROM orders.ticket_transfers tr'],
      ['2 + tickets',            'FROM orders.ticket_transfers tr JOIN tickets.tickets tt ON tt.id = tr.ticket_id'],
      ['3 + orders',             'FROM orders.ticket_transfers tr JOIN tickets.tickets tt ON tt.id = tr.ticket_id JOIN orders.orders o ON o.id = tt.order_id'],
      ['4 + events',             'FROM orders.ticket_transfers tr JOIN tickets.tickets tt ON tt.id = tr.ticket_id JOIN orders.orders o ON o.id = tt.order_id JOIN catalog.events et ON et.id = o.event_id'],
      ['5 + venues',             'FROM orders.ticket_transfers tr JOIN tickets.tickets tt ON tt.id = tr.ticket_id JOIN orders.orders o ON o.id = tt.order_id JOIN catalog.events et ON et.id = o.event_id JOIN catalog.venues v ON v.id = et.venue_id'],
      ['6 + ticket_types',       'FROM orders.ticket_transfers tr JOIN tickets.tickets tt ON tt.id = tr.ticket_id JOIN orders.orders o ON o.id = tt.order_id JOIN catalog.events et ON et.id = o.event_id JOIN catalog.venues v ON v.id = et.venue_id JOIN catalog.ticket_types tty ON tty.id = tt.ticket_type_id'],
    ];
    const { Client } = await import('pg');
    for (const [label, from] of steps) {
      // OWNER pool = bypassrls, takze RLS tu nehraje roli — meri se cisty JOIN
      const r = await clone.pool.query(`SELECT 1 ${from} WHERE tr.transfer_token = $1`, [token]);
      console.log(`   [bisect] ${label.padEnd(22)} rowCount=${r.rowCount}`);
    }
    // a totez pod tixly_app v servisnim kontextu, jako to dela routa
    const a = new Client({ connectionString: process.env.DATABASE_URL });
    await a.connect();
    await a.query("SET app.role='system'");
    for (const [label, from] of steps) {
      const r = await a.query(`SELECT 1 ${from} WHERE tr.transfer_token = $1`, [token]);
      console.log(`   [bisect/app] ${label.padEnd(22)} rowCount=${r.rowCount}`);
    }
    await a.end();
  }, 180_000);

  it('my/orders/[id]/upgrade — vlastnik vs CIZI (posledni z 8)', async () => {
    const t = await clone.pool.query('SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1',
      [chain.orderId]);
    const tid = t.rows[0]?.id as string;
    // druhy, drazsi typ listku jako cil upgradu
    const tt2 = await clone.pool.query(
      `INSERT INTO catalog.ticket_types (event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
       VALUES ($1,'VIP','seated',90000,10,10,'public') RETURNING id`, [chain.eventId]);
    const { POST } = await import('@/app/api/my/orders/[id]/upgrade/route');
    const hit = async (uid: string) => {
      const r = await POST(new NextRequest('http://localhost:3000/x', {
        method: 'POST', headers: { 'x-user-id': uid, 'content-type': 'application/json' },
        body: JSON.stringify({ ticketId: tid, newTicketTypeId: tt2.rows[0].id }),
      }) as never, { params: { id: chain.orderId } } as never);
      return `${r.status} ${(await r.text()).slice(0, 90)}`;
    };
    console.log('[my/orders/upgrade] vlastnik', await hit(chain.userId));
    console.log('[my/orders/upgrade] CIZI    ', await hit(cizi.id));
  }, 180_000);
});
