// @vitest-environment node
/**
 * Kolo 2 / krok 5 — S8: oficiální checkout předplatného padal 500
 * „there is no unique or exclusion constraint matching the ON CONFLICT specification".
 *
 * Příčina: `ON CONFLICT (email)` na identity.users — unikátní index na e-mail je PARCIÁLNÍ
 * (WHERE anonymized_at IS NULL). Unit test route.test.ts mockuje pg, takže drift nezachytí;
 * tenhle test běží proti skutečnému schématu pod tixly_app.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

// Kolo 10: předplatné je za přepínačem (výchozí vypnuto → 404); tady se testuje ZAPNUTÁ funkce.
process.env.NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS = '1';

const run = describe.skipIf(!hasLocalDb);

run('Krok 5 — S8: checkout předplatného proti skutečnému schématu', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  async function pkg() {
    const c = await clone.seed.chain();
    const id = randomUUID();
    await clone.pool.query(
      `INSERT INTO subscriptions.packages (id, promoter_id, name, slug, season_label, base_price_halire, status, sale_start, abo_type, category)
       VALUES ($1,$2,'Abo','abo-'||$3,'26/27',300000,'on_sale',now()-interval '1 day','fixed','theater')`, [id, c.promoterId, randomUUID().slice(0, 8)]);
    return id;
  }
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/subscriptions/checkout/route');
    const r = await throughMiddleware(new Request('http://localhost/api/subscriptions/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': `10.55.${Math.floor(Math.random() * 250)}.9` }, body: JSON.stringify(body),
    }), POST as (r: NextRequest) => Promise<Response>);
    return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> };
  };

  it('nový kupec (guest): 200, holder pending_payment, platební odkaz', async () => {
    const packageId = await pkg();
    const email = `abo-${randomUUID().slice(0, 8)}@x.test`;
    const r = await post({ packageId, buyerEmail: email, buyerName: 'Abo Kupec' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.holderId).toBeTruthy();
    const h = (await clone.pool.query<{ status: string; payment_status: string }>(
      `SELECT status, payment_status FROM subscriptions.holders WHERE id=$1`, [r.json.holderId])).rows[0];
    expect(h).toEqual({ status: 'pending_payment', payment_status: 'pending' });
  });

  it('existující účet se stejným e-mailem: použije se, jméno účtu se z anonymního požadavku NEpřepíše', async () => {
    const packageId = await pkg();
    const u = await clone.seed.user('abo-exist', 'Původní Jméno');
    const r = await post({ packageId, buyerEmail: u.email, buyerName: 'Útočník Přepisovač' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const holderUser = (await clone.pool.query<{ user_id: string }>(`SELECT user_id FROM subscriptions.holders WHERE id=$1`, [r.json.holderId])).rows[0].user_id;
    expect(holderUser).toBe(u.id);
    const name = (await clone.pool.query<{ name: string }>(`SELECT name FROM identity.users WHERE id=$1`, [u.id])).rows[0].name;
    expect(name).toBe('Původní Jméno');
  });
});
