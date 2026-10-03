// @vitest-environment node
/**
 * Kolo 2 / krok 5 — výchozí QR politika: rotující TOTP místo static_allowed.
 *
 * Audit (e2e_03:V0, report „QR / TOTP"): výchozí `static_allowed` = u brány stačí UUID vstupenky.
 * Požadavek: výchozí politika = rotující TOTP; statický QR jen jako EXPLICITNÍ volba pořadatele.
 * Zvolená výchozí hodnota `rotating_24h`: TOTP je u brány povinný od 24 h před začátkem po celou
 * akci (PDF zůstává ke stažení — V2 požaduje funkční PDF), `rotating_only` by PDF zakázalo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H<C = unknown> = (r: NextRequest, ctx: C) => Promise<Response>;

run('Krok 5 — výchozí QR politika = rotující TOTP', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  async function promoterToken(c: { promoterId: string; adminUserId: string }) {
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id=$1`, [c.promoterId]).catch(() => {});
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query<{ email: string }>(`SELECT email FROM identity.users WHERE id=$1`, [c.adminUserId])).rows[0].email;
    return signAccessToken({ id: c.adminUserId, email, name: 'P' } as never,
      { isPlatformAdmin: false, promoterMemberships: [{ promoterId: c.promoterId, status: 'active', role: 'owner' } as never] });
  }
  const req = (path: string, token: string, body: unknown) => new Request(`http://localhost${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });

  it('DB: nová akce bez explicitní volby má rotující politiku', async () => {
    const c = await clone.seed.chain();
    const id = randomUUID();
    await clone.pool.query(`INSERT INTO catalog.events (id, organizer_id, promoter_id, venue_id, title, slug, status, currency, event_type, date_start)
                            VALUES ($1,$2,$2,$4,'QR',$3,'draft','CZK','concert',now()+interval '3 days')`, [id, c.promoterId, `qr-${id.slice(0, 8)}`, c.venueId]);
    const p = (await clone.pool.query<{ q: string }>(`SELECT qr_policy q FROM catalog.events WHERE id=$1`, [id])).rows[0].q;
    expect(p).toBe('rotating_24h');
  });

  it('API: akce založená pořadatelem bez qrPolicy → rotating_24h; explicitní static_allowed zůstane', async () => {
    const c = await clone.seed.chain();
    const token = await promoterToken(c);
    const { POST } = await import('@/app/api/admin/events/route');
    const mk = async (extra: Record<string, unknown>) => {
      const r = await throughMiddleware(req('/api/admin/events', token, {
        title: `QR akce ${randomUUID().slice(0, 6)}`, description: 'Testovací akce pro QR politiku.', category: 'music',
        dateStart: new Date(Date.now() + 20 * 864e5).toISOString(), venueId: c.venueId, currency: 'CZK',
        ticketTypes: [{ name: 'Stání', priceHalire: 10000, capacity: 10 }], ...extra,
      }), POST as H);
      const j = await r.json() as { id?: string; eventId?: string; event?: { id?: string } };
      expect(r.status, JSON.stringify(j)).toBeLessThan(300);
      const eid = j.id ?? j.eventId ?? j.event?.id;
      return (await clone.pool.query<{ q: string }>(`SELECT qr_policy q FROM catalog.events WHERE id=$1`, [eid])).rows[0].q;
    };
    expect(await mk({})).toBe('rotating_24h');
    expect(await mk({ qrPolicy: 'static_allowed' })).toBe('static_allowed');
  });

  it('brána u výchozí politiky: jen UUID vstupenky → totp_required; platný TOTP → admitted', async () => {
    const c = await clone.seed.chain();
    // akce za 2 h (v okně 24 h) s výchozí politikou
    await clone.pool.query(`UPDATE catalog.events SET date_start = now() + interval '2 hours', qr_policy = DEFAULT WHERE id=$1`, [c.eventId]);
    const o = await clone.seed.order(c);
    const issued = await clone.seed.tickets(o.orderId);
    const t = issued[0] as unknown as { ticketId: string; totpSecretRaw: Buffer };
    const token = await promoterToken(c);
    const { POST } = await import('@/app/api/admin/scanner/validate/route');
    const noTotp = await throughMiddleware(req('/api/admin/scanner/validate', token, { ticketId: t.ticketId }), POST as H);
    expect((await noTotp.json() as { result: string }).result).toBe('totp_required');
    const st = (await clone.pool.query<{ s: string }>(`SELECT status s FROM tickets.tickets WHERE id=$1`, [t.ticketId])).rows[0].s;
    expect(st, 'bez TOTP vstupenka zůstává valid').toBe('valid');
    const { generateTotpCode } = await import('@/lib/totp/verify');
    const ok = await throughMiddleware(req('/api/admin/scanner/validate', token, { ticketId: t.ticketId, totpCode: generateTotpCode(t.totpSecretRaw) }), POST as H);
    expect((await ok.json() as { result: string }).result).toBe('admitted');
  });
});
