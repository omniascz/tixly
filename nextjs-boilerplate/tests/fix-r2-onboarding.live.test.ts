// @vitest-environment node
/**
 * Kolo 2 — onboarding pořadatele (průvodce) padal na driftu schématu.
 *
 * Nalezeno při změně výchozí QR politiky: krok 4 (první akce) zakládal událost se sloupci
 * duration_minutes / intermission_minutes, které catalog.events NEMÁ (42703), s hodnotami
 * vat_category='entertainment' a qr_policy='static', které porušují CHECK; a každý krok (1–8)
 * končil v markStepDone na array_remove(jsonb, integer) — completed_steps je jsonb.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H<C = unknown> = (r: NextRequest, ctx: C) => Promise<Response>;

run('Onboarding pořadatele — krok 4 a záznam kroků', () => {
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

  it('krok 4: první akce se založí s výchozí QR politikou a krok se zaznamená', async () => {
    const c = await clone.seed.chain();
    const token = await promoterToken(c);
    await clone.pool.query(`INSERT INTO platform.promoter_onboarding (promoter_id, completed_steps) VALUES ($1, '[1,2,3]'::jsonb)`, [c.promoterId]);
    const prodId = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.productions (promoter_id, title, slug) VALUES ($1,'Inscenace',$2) RETURNING id`, [c.promoterId, `ins-${randomUUID().slice(0, 6)}`])).rows[0].id;
    const { POST } = await import('@/app/api/admin/onboarding/step/[step]/route');
    const r = await throughMiddleware(req('/api/admin/onboarding/step/4', token, {
      productionId: prodId, venueId: c.venueId, dateStart: new Date(Date.now() + 9 * 864e5).toISOString(), durationMinutes: 90,
    }), POST as H<{ params: { step: string } }>, { params: { step: '4' } });
    const j = await r.json() as { eventId?: string };
    expect(r.status, JSON.stringify(j)).toBe(200);
    const p = (await clone.pool.query<{ q: string }>(`SELECT qr_policy q FROM catalog.events WHERE id=$1`, [j.eventId])).rows[0].q;
    expect(p).toBe('rotating_24h');
    const prog = (await clone.pool.query<{ s: unknown; cur: number }>(`SELECT completed_steps s, current_step cur FROM platform.promoter_onboarding WHERE promoter_id=$1`, [c.promoterId])).rows[0];
    expect(prog).toEqual({ s: [1, 2, 3, 4], cur: 5 });
  });
});
