/**
 * red-green-488.live.test.ts — R-58 skupina royalty_* (RED = klon BEZ 488).
 *
 * Meri se skutecnym route handlerem pod `tixly_app`, ne rucnim SET:
 *   RED   POST /api/admin/events/[id]/royalties → 42501 (policy cte app.bypass_rls)
 *   GREEN po aplikaci 488 na temz klonu         → 201 + radek v DB
 * K tomu izolace: cizi poradatel smlouvu nevidi (nova vetev nesmi otevrit cizi data).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { NextRequest } from 'next/server';
import { createLiveClone, makeSeed, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;

d('RED->GREEN 488 royalty_* policies', () => {
  let clone: LiveClone;
  let chain: Awaited<ReturnType<ReturnType<typeof makeSeed>['chain']>>;
  let other: Awaited<ReturnType<ReturnType<typeof makeSeed>['chain']>>;

  beforeAll(async () => {
    clone = await createLiveClone('rg488', { exclude: ['488'] });
    const seed = makeSeed(clone.pool);
    chain = await seed.chain();
    other = await seed.chain();
  }, 300_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  const create = async (uid: string, eventId: string) => {
    const { POST } = await import('@/app/api/admin/events/[id]/royalties/route');
    try {
      const res = (await POST(new NextRequest(`http://localhost:3000/api/admin/events/${eventId}/royalties`, {
        method: 'POST',
        headers: { 'x-user-id': uid, 'content-type': 'application/json' },
        body: JSON.stringify({ artist_name: 'RG Kapela', royalty_type: 'percent', percent_rate: 10 }),
      }) as never, { params: { id: eventId } } as never)) as Response;
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (e) {
      return { status: (e as { code?: string }).code ?? String(e), body: null };
    }
  };

  it('RED 42501 → GREEN 201, cizi poradatel nevidi', async () => {
    const red = await create(chain.adminUserId, chain.eventId);
    console.log('[488] RED  =', red.status);
    expect(red.status).toBe('42501');

    await clone.pool.query(readFileSync('../migrations/488_royalty_policies_guc_drift.sql', 'utf8'));

    const green = await create(chain.adminUserId, chain.eventId);
    console.log('[488] GREEN =', green.status, JSON.stringify(green.body).slice(0, 120));
    expect(green.status).toBe(201);
    const row = await clone.pool.query(`SELECT promoter_id FROM lineups.royalty_agreements WHERE id=$1`, [green.body.id]);
    expect(row.rows[0].promoter_id).toBe(chain.promoterId);

    // Izolace: GET smluv cizi akce cizim poradatelem → 403, a pres jeho vlastni akci smlouvu neuvidi.
    const { GET } = await import('@/app/api/admin/events/[id]/royalties/route');
    const foreign = (await GET(new NextRequest(`http://localhost:3000/api/admin/events/${chain.eventId}/royalties`, {
      headers: { 'x-user-id': other.adminUserId },
    }) as never, { params: { id: chain.eventId } } as never)) as Response;
    console.log('[488] cizi poradatel GET cizi akce =', foreign.status);
    expect(foreign.status).toBe(403);

    const { runWithPromoterContext, db } = await import('@/lib/db/rls-pool');
    const seen = await runWithPromoterContext(other.promoterId, () =>
      db().query(`SELECT count(*)::int AS n FROM lineups.royalty_agreements WHERE id = $1`, [green.body.id]));
    console.log('[488] cizi poradatel vidi radku =', seen.rows[0].n);
    expect(seen.rows[0].n).toBe(0);
  }, 180_000);
});
