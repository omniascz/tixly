// @vitest-environment node
/**
 * Kolo 7 / krok 2a — DPH bez nastavení (C-54). Doklad bral sazbu z `promoters.vat_rate_pct ?? 0`,
 * e-mail z natvrdo zadané tabulky v kódu; placený typ vstupenky plátce šel prodat bez sazby.
 *
 * Očekávané:
 *   - plátce bez platného DIČ nebo placený typ plátce bez kódu sazby → checkout 422 VAT_NOT_CONFIGURED,
 *     schválení k publikaci 422 a akce zůstane neveřejná;
 *   - neplátce bez sazby prodává; vstupenka zdarma sazbu nepotřebuje; po doplnění sazby prodej jde;
 *   - typ vstupenky: plátce nemůže uložit placený typ bez sazby;
 *   - KYC: plátce bez DIČ → 422;
 *   - v kódu nejsou sazby natvrdo ani výchozí 0 %.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;
const SRC = path.resolve(__dirname, '../src');

describe('Kolo 7 — žádné sazby DPH natvrdo v kódu', () => {
  it('src/ neobsahuje tabulku procent DPH ani výchozí sazbu (PDF 10 %)', () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(n) || /\.test\.tsx?$/.test(n)) continue;
        const s = readFileSync(p, 'utf8');
        if (/cultural:\s*\d+|standard:\s*2[0-9]\b/.test(s)) offenders.push(`${path.relative(SRC, p)} (tabulka sazeb)`);
        if (/DEFAULT_VAT_RATE_PCT|vatRatePct\s*===\s*10/.test(s)) offenders.push(`${path.relative(SRC, p)} (výchozí sazba)`);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

run('Kolo 7 — DPH: publikace a prodej jen s nastavenou sazbou', () => {
  let clone: LocalClone;
  let adminTok: string;

  const tokenFor = async (userId: string, memberships: unknown[] = [], isPlatformAdmin = false) => {
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [userId])).rows[0].email;
    return signAccessToken({ id: userId, email, name: 'U' } as never, { isPlatformAdmin, promoterMemberships: memberships } as never);
  };
  const staffTok = (c: { adminUserId: string; promoterId: string }) =>
    tokenFor(c.adminUserId, [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }]);

  beforeAll(async () => {
    clone = await createLocalClone();
    const a = await clone.seed.user('padm', 'Admin');
    await clone.pool.query(`UPDATE identity.users SET is_platform_admin = TRUE WHERE id=$1`, [a.id]);
    adminTok = await tokenFor(a.id, [], true);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const req = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body: unknown, tok?: string, ctx: unknown = {}) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forwarded-for': `198.18.0.${Math.floor(Math.random() * 250) + 1}`, ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    return { status: r.status, body: await r.text() };
  };
  const checkout = (c: { eventId: string; ticketTypeId: string }) => req('POST', '/api/checkout', () => import('@/app/api/checkout/route'),
    { eventId: c.eventId, ticketTypeId: c.ticketTypeId, quantity: 1, buyerEmail: `vat-${randomUUID().slice(0, 8)}@fix.test`, buyerName: 'K' });

  it('plátce, placený typ bez sazby → checkout 422 VAT_NOT_CONFIGURED; po doplnění sazby 200', async () => {
    const c = await clone.seed.chain({ vatRateCode: null });
    const r = await checkout(c);
    expect(r.status, r.body).toBe(422);
    expect(r.body).toMatch(/VAT_NOT_CONFIGURED/);
    await clone.pool.query(`UPDATE catalog.ticket_types SET vat_rate_code='CZ_REDUCED' WHERE id=$1`, [c.ticketTypeId]);
    expect((await checkout(c)).status).toBe(200);
  });

  it('plátce bez DIČ → checkout 422', async () => {
    const c = await clone.seed.chain({ dic: null });
    const r = await checkout(c);
    expect(r.status, r.body).toBe(422);
    expect(r.body).toMatch(/DIČ/);
  });

  it('neplátce bez sazby prodává; vstupenka zdarma plátce sazbu nepotřebuje', async () => {
    const np = await clone.seed.chain({ vatPayer: false, dic: null, vatRateCode: null });
    expect((await checkout(np)).status).toBe(200);
    const free = await clone.seed.chain({ vatRateCode: null, basePrice: 0 });
    const r = await checkout(free);
    expect(r.status, r.body).not.toBe(422);
  });

  it('schválení k publikaci: placený typ plátce bez sazby → 422, akce zůstane neveřejná', async () => {
    const c = await clone.seed.chain({ vatRateCode: null, status: 'pending_review' });
    const r = await req('POST', `/api/platform/moderation/${c.eventId}/approve`, () => import('@/app/api/platform/moderation/[eventId]/approve/route'),
      {}, adminTok, { params: { eventId: c.eventId } });
    expect(r.status, r.body).toBe(422);
    expect((await clone.pool.query(`SELECT status FROM catalog.events WHERE id=$1`, [c.eventId])).rows[0].status).toBe('pending_review');
  });

  it('typ vstupenky: plátce nemůže uložit placený typ bez sazby (422), se sazbou ano', async () => {
    const c = await clone.seed.chain();
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]);
    const tok = await staffTok(c);
    const mod = () => import('@/app/api/admin/events/[id]/ticket-types/route');
    const base = { name: 'VIP', priceHalire: 90000, totalQty: 10 };
    const bad = await req('POST', `/api/admin/events/${c.eventId}/ticket-types`, mod, base, tok, { params: { id: c.eventId } });
    expect(bad.status, bad.body).toBe(422);
    const ok = await req('POST', `/api/admin/events/${c.eventId}/ticket-types`, mod, { ...base, vatRateCode: 'CZ_STANDARD' }, tok, { params: { id: c.eventId } });
    expect([200, 201], ok.body).toContain(ok.status);
  });
});

run('Kolo 7 — profil pořadatele: plátce DPH musí mít platné DIČ', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  it('KYC: plátce s neplatným DIČ → 422 (ještě před dotazem do ARES)', async () => {
    const c = await clone.seed.chain();
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    const tok = await signAccessToken({ id: c.adminUserId, email, name: 'S' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
    const { POST } = await import('@/app/api/admin/kyc/route');
    const r = await throughMiddleware(new Request('http://localhost/api/admin/kyc', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ ico: '12345678', dic: '1234', companyName: 'Firma s.r.o.', companyAddress: 'Ulice 1, Praha', bankAccount: '123456789/0100', vatPayer: true }),
    }), POST as unknown as H, {});
    expect(r.status, await r.clone().text()).toBe(422);
    expect(await r.text()).toMatch(/DIC_INVALID/);
  });
});
