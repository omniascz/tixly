// @vitest-environment node
/**
 * Kolo 4 / krok 2 — POST /api/scanner/school-group (odbavení školní skupiny) neměl žádné
 * ověření obsluhy: kdokoli s QR tokenem skupiny dostal „admitted" + název školy a počty
 * žáků/učitelů a odbavení se zalogovalo, i když skenoval někdo mimo pořadatele.
 *
 * Očekávané: jen přihlášený aktivní pořadatel, kterému rezervace patří. Anonym 401;
 * cizí pořadatel → stejná odpověď jako neexistující token (BOOKING_NOT_FOUND), bez údajů
 * o škole; vlastní pořadatel → admitted.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 2 (kolo 4) — scanner/school-group vyžaduje obsluhu pořadatele', () => {
  let clone: LocalClone;
  let token: string;
  let ownTok: string;
  let foreignTok: string;

  beforeAll(async () => {
    clone = await createLocalClone();
    const { signAccessToken } = await import('@/lib/auth');
    const own = await clone.seed.chain();
    const foreign = await clone.seed.chain();
    await clone.pool.query(`UPDATE platform.promoters SET status='active' WHERE id = ANY($1)`, [[own.promoterId, foreign.promoterId]]);
    await clone.pool.query(`UPDATE catalog.events SET date_start = NOW() + INTERVAL '1 hour' WHERE id=$1`, [own.eventId]);
    token = (await clone.pool.query<{ group_qr_token: string }>(
      `INSERT INTO orders.school_bookings (event_id, promoter_id, contact_name, contact_email, school_name,
         student_count, teacher_count, unit_price_halire, total_price_halire, status)
       VALUES ($1,$2,'Učitelka','ucitel@skola.test','ZŠ Testovací',25,2,5000,125000,'confirmed')
       RETURNING group_qr_token`, [own.eventId, own.promoterId])).rows[0].group_qr_token;
    const tok = async (userId: string, promoterId: string) => {
      const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [userId])).rows[0].email;
      return signAccessToken({ id: userId, email, name: 'P' } as never, {
        isPlatformAdmin: false,
        promoterMemberships: [{ promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
      } as never);
    };
    ownTok = await tok(own.adminUserId, own.promoterId);
    foreignTok = await tok(foreign.adminUserId, foreign.promoterId);
  }, 180_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const scan = async (h: Record<string, string>) => {
    const { POST } = await import('@/app/api/scanner/school-group/route');
    return throughMiddleware(new Request('http://localhost/api/scanner/school-group', {
      method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ token }),
    }), POST as H, {});
  };

  it('anonym 401 bez údajů o škole', async () => {
    const r = await scan({});
    const body = await r.text();
    expect(r.status, body).toBe(401);
    expect(body).not.toContain('Testovací');
  });

  it('cizí pořadatel: nepustí, bez údajů o škole', async () => {
    const r = await scan({ authorization: `Bearer ${foreignTok}` });
    const body = await r.text();
    expect(body).not.toContain('Testovací');
    expect(body).not.toContain('"admitted":true');
  });

  it('vlastní pořadatel: admitted', async () => {
    const r = await scan({ authorization: `Bearer ${ownTok}` });
    const body = await r.text();
    expect(r.status, body).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ admitted: true, schoolName: 'ZŠ Testovací', studentCount: 25 });
  });
});
