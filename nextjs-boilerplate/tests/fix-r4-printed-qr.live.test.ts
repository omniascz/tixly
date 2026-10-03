// @vitest-environment node
/**
 * Kolo 4 / krok 3h — QR na vstupence tištěné prodejcem nešel naskenovat (FIX_REPORT_R3 bod 4):
 * tisk kreslil pseudo-matici z textu `TXP:<uuid>` (není to QR ani formát, který skener zná),
 * a i skutečný tiskový token TXP1 skener pod qr_policy=rotating_24h do 24 h před akcí odmítl
 * (`totp_required` — tištěný papír TOTP nemá).
 *
 * Očekávané: API tisku prodejce vrací podepsaný statický token TXP2 vázaný na vstupenku A akci;
 * skener (POST /api/admin/scanner/validate) ho ověří podpisem a pod rotating_24h i 1 h před
 * akcí vpustí; padělaný token nebo token vstupenky převedené na jiný termín → odmítnut.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 3h (kolo 4) — tištěná vstupenka prodejce se dá naskenovat (TXP2)', () => {
  let clone: LocalClone;
  let fc: Awaited<ReturnType<LocalClone['seed']['fullChain']>>;
  let resellerTok: string;
  let scannerTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    fc = await clone.seed.fullChain();
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc.promoterId]);
    // rotating_24h a akce za hodinu → bez platného tiskového tokenu by skener chtěl TOTP
    await clone.pool.query(`UPDATE catalog.events SET qr_policy='rotating_24h', date_start = NOW() + INTERVAL '1 hour' WHERE id=$1`, [fc.eventId]);
    const pid = randomUUID();
    await clone.pool.query(`INSERT INTO platform.reseller_partners (id, name, contact_email, password_hash, commission_pct, status) VALUES ($1,'Prodejna',$2,'!x',5,'active')`, [pid, `p-${pid.slice(0, 6)}@fix.test`]);
    await clone.pool.query(`INSERT INTO orders.reseller_sales (partner_id, order_id, commission_pct, commission_amount_halire) VALUES ($1,$2,5,500)`, [pid, fc.orderId]);
    const { signResellerToken } = await import('@/lib/reseller-auth');
    resellerTok = await signResellerToken({ partnerId: pid, partnerName: 'P', commissionPct: 5 });
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [fc.adminUserId])).rows[0].email;
    const { signAccessToken } = await import('@/lib/auth');
    scannerTok = await signAccessToken({ id: fc.adminUserId, email, name: 'S' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId: fc.promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const printTokens = async () => {
    const { GET } = await import('@/app/api/reseller/orders/[orderId]/tickets/route');
    const r = await throughMiddleware(new Request(`http://localhost/api/reseller/orders/${fc.orderId}/tickets`, {
      headers: { authorization: `Bearer ${resellerTok}` } }), GET as unknown as H, { params: { orderId: fc.orderId } });
    expect(r.status).toBe(200);
    return ((await r.json()) as { tickets: { id: string; printToken?: string }[] }).tickets;
  };
  const scan = async (printToken: string) => {
    const { POST } = await import('@/app/api/admin/scanner/validate/route');
    const r = await throughMiddleware(new Request('http://localhost/api/admin/scanner/validate', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${scannerTok}` },
      body: JSON.stringify({ printToken, eventId: fc.eventId }),
    }), POST as unknown as H, {});
    return { status: r.status, body: await r.text() };
  };

  it('API tisku vrací podepsaný token TXP2 a skener ho pod rotating_24h 1 h před akcí vpustí', async () => {
    const [t] = await printTokens();
    expect(t.printToken, 'tisk musí nést tiskový token').toMatch(/^TXP2\./);
    const s = await scan(t.printToken!);
    expect(s.status, s.body).toBe(200);
    expect(s.body).toMatch(/admitted|valid/);
    expect((await clone.pool.query(`SELECT status FROM tickets.tickets WHERE id=$1`, [t.id])).rows[0].status).toBe('used');
  });

  it('padělaný token → odmítnut', async () => {
    const [t] = await printTokens();
    const forged = t.printToken!.slice(0, -4) + (t.printToken!.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const s = await scan(forged);
    expect(s.status, s.body).toBe(401);
  });

  it('token vstupenky po převodu na jiný termín neplatí (vazba na akci)', async () => {
    const fc2 = await clone.seed.fullChain();
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [fc2.promoterId]);
    const tId = (await clone.pool.query(`SELECT id FROM tickets.tickets WHERE order_id=$1 LIMIT 1`, [fc2.orderId])).rows[0].id;
    const { signEventPrintToken } = await import('@/lib/tickets/print-token');
    const token = signEventPrintToken(tId, fc2.eventId);
    // vstupenka přesunuta na akci fc (jiný termín) — token z původní akce už nesmí projít
    await clone.pool.query(`UPDATE orders.orders SET event_id=$2 WHERE id=$1`, [fc2.orderId, fc.eventId]);
    const s = await scan(token);
    expect(s.status, s.body).toBe(401);
  });
});
