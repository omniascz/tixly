// @vitest-environment node
/**
 * Kolo 4 / krok 3d — subscriptions.holders.restwert_credit_halire (a další peněžní / stavové
 * sloupce abonentky) šly kupci změnit pod jeho RLS kontextem: politika p_scope pouští kupce
 * na vlastní řádek a RLS sloupce nehlídá (FIX_REPORT_R3 bod 4). Restwert je kredit, kterým se
 * platí v checkoutu — kupec si ho mohl libovolně navýšit.
 *
 * Očekávané (migrace 492): kupec chráněné sloupce nezmění (42501), údaje držitele ano;
 * servisní kontext (checkout, pick přes asSystemInTx) chráněné sloupce měnit může.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';

const run = describe.skipIf(!hasLocalDb);

run('Krok 3d (kolo 4) — chráněné sloupce abonentky', () => {
  let clone: LocalClone;
  let holderId: string;
  let userId: string;
  let rls: typeof import('@/lib/db/rls-pool');

  beforeAll(async () => {
    clone = await createLocalClone();
    rls = await import('@/lib/db/rls-pool');
    const c = await clone.seed.chain();
    const u = await clone.seed.user('abonent');
    userId = u.id;
    const pkg = (await clone.pool.query<{ id: string }>(
      `INSERT INTO subscriptions.packages (promoter_id, name, slug, season_label, base_price_halire)
       VALUES ($1,'Abo',$2,'2026/27',100000) RETURNING id`, [c.promoterId, `abo-${Date.now()}`])).rows[0].id;
    holderId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO subscriptions.holders (package_id, user_id, holder_name, holder_email, valid_until, price_paid_halire, restwert_credit_halire, status)
       VALUES ($1,$2,'Abonent',$3,now()+interval '300 days',100000,5000,'active') RETURNING id`, [pkg, u.id, u.email])).rows[0].id;
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const asBuyer = async (sql: string, p: unknown[]) => {
    try {
      const r = await rls.runWithUserContext(userId, () => rls.db().query(sql, p));
      return r.rowCount;
    } catch (e) { return (e as { code?: string }).code; }
  };
  const holder = async () => (await clone.pool.query(`SELECT restwert_credit_halire, status, valid_until, preferred_zone FROM subscriptions.holders WHERE id=$1`, [holderId])).rows[0];

  it('kupec nenavýší restwert, nezmění stav ani platnost', async () => {
    const res = {
      restwert: await asBuyer(`UPDATE subscriptions.holders SET restwert_credit_halire = 9999999 WHERE id=$1`, [holderId]),
      status: await asBuyer(`UPDATE subscriptions.holders SET status = 'active', valid_until = now() + interval '20 years' WHERE id=$1`, [holderId]),
      price: await asBuyer(`UPDATE subscriptions.holders SET price_paid_halire = 0 WHERE id=$1`, [holderId]),
    };
    console.log('[3d]', JSON.stringify(res));
    expect(res).toEqual({ restwert: '42501', status: '42501', price: '42501' });
    expect(Number((await holder()).restwert_credit_halire)).toBe(5000);
  });

  it('kupec dál mění údaje držitele; servis mění restwert', async () => {
    expect(await asBuyer(`UPDATE subscriptions.holders SET preferred_zone = 'Balkon', holder_phone = '+420777000111' WHERE id=$1`, [holderId])).toBe(1);
    expect((await holder()).preferred_zone).toBe('Balkon');
    const svc = await rls.runWithServiceContext(() => rls.db().query(`UPDATE subscriptions.holders SET restwert_credit_halire = 4000 WHERE id=$1`, [holderId]));
    expect(svc.rowCount).toBe(1);
    expect(Number((await holder()).restwert_credit_halire)).toBe(4000);
  });
});
