// @vitest-environment node
/**
 * Kolo 4 / krok 2 — firemní (B2B) kredit.
 *
 * 1) POST /api/b2b/verify vracel název firmy a ZŮSTATEK kreditu komukoli, kdo znal kód účtu
 *    (8 hex znaků, firmy ho sdílejí mezi zaměstnanci). E-mail v těle nic neprokazuje.
 * 2) POST /api/checkout s paymentMethod='b2b_credit' strhl cenu z kreditu firmy JEN podle kódu
 *    účtu — bez ověření, že kupující je oprávněný uživatel účtu. Kdo znal kód, nakupoval na
 *    účet firmy.
 *
 * Očekávané: kredit firmy (zjištění zůstatku i platba) jen přihlášený uživatel, jehož e-mail je
 * členem účtu (připojený nebo admin účtu). Anonym / nečlen → 401/403, kredit beze změny.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 2 (kolo 4) — B2B kredit jen pro členy účtu', () => {
  let clone: LocalClone;
  let code: string;
  let accountId: string;
  let chain: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  let memberTok: string;
  let memberEmail: string;
  let outsiderTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    chain = await clone.seed.chain({ basePrice: 20000, totalQty: 50, remainingQty: 50 });
    const acc = (await clone.pool.query<{ id: string; account_code: string }>(
      `INSERT INTO platform.b2b_accounts (company_name, ico, contact_email, credit_balance_halire)
       VALUES ('Firma s.r.o.', '12345678', 'ucetni@firma.test', 1000000) RETURNING id, account_code`)).rows[0];
    accountId = acc.id; code = acc.account_code;
    const member = await clone.seed.user('clen');
    memberEmail = member.email;
    await clone.pool.query(
      `INSERT INTO platform.b2b_account_users (account_id, email, name, is_admin, joined_at)
       VALUES ($1,$2,'Člen',false,NOW())`, [accountId, member.email]);
    const outsider = await clone.seed.user('cizi');
    const { signAccessToken } = await import('@/lib/auth');
    const t = (u: { id: string; email: string }) =>
      signAccessToken({ id: u.id, email: u.email, name: 'B' } as never, { isPlatformAdmin: false, promoterMemberships: [] } as never);
    memberTok = await t(member);
    outsiderTok = await t(outsider);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const balance = async () =>
    Number((await clone.pool.query(`SELECT credit_balance_halire FROM platform.b2b_accounts WHERE id=$1`, [accountId])).rows[0].credit_balance_halire);

  const verify = async (h: Record<string, string>, body: unknown) => {
    const { POST } = await import('@/app/api/b2b/verify/route');
    return throughMiddleware(new Request('http://localhost/api/b2b/verify', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost', ...h }, body: JSON.stringify(body),
    }), POST as unknown as H, {});
  };
  const checkout = async (h: Record<string, string>) => {
    const { POST } = await import('@/app/api/checkout/route');
    return throughMiddleware(new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250) + 1}`, ...h },
      body: JSON.stringify({
        eventId: chain.eventId, ticketTypeId: chain.ticketTypeId, quantity: 1,
        buyerEmail: `b2b-${randomUUID().slice(0, 8)}@tixly.test`, buyerName: 'B2B Kupec',
        paymentMethod: 'b2b_credit', b2bAccountCode: code,
      }),
    }), POST as unknown as H, {});
  };

  it('b2b/verify: anonym s kódem (i s e-mailem člena) nedostane zůstatek', async () => {
    for (const body of [{ accountCode: code }, { accountCode: code, email: memberEmail }]) {
      const r = await verify({}, body);
      const t = await r.text();
      expect([401, 403], t).toContain(r.status);
      expect(t).not.toContain('1000000');
    }
    const o = await verify({ authorization: `Bearer ${outsiderTok}` }, { accountCode: code });
    expect([401, 403]).toContain(o.status);
    expect(await o.text()).not.toContain('1000000');
  });

  it('b2b/verify: přihlášený člen zůstatek vidí', async () => {
    const r = await verify({ authorization: `Bearer ${memberTok}` }, { accountCode: code });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await r.json()).toMatchObject({ valid: true, companyName: 'Firma s.r.o.', balanceHalire: 1000000 });
  });

  it('checkout b2b_credit: anonym ani nečlen nezaplatí z kreditu firmy', async () => {
    const before = await balance();
    for (const h of [{}, { authorization: `Bearer ${outsiderTok}` }] as Record<string, string>[]) {
      const r = await checkout(h);
      expect([401, 403], await r.clone().text()).toContain(r.status);
    }
    expect(await balance()).toBe(before);
  });

  it('checkout b2b_credit: přihlášený člen zaplatí a kredit klesne o cenu', async () => {
    const before = await balance();
    const r = await checkout({ authorization: `Bearer ${memberTok}` });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(await balance()).toBe(before - 20000);
  });
});
