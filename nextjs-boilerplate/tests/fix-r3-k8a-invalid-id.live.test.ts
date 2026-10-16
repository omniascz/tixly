// @vitest-environment node
/**
 * Kolo 3 / krok 4 — K8a (AUDIT_REPORT.md S9): SQLi řetězec v ID (`/api/events/{id}/ticket-types`)
 * vracel 200 `{"ticketTypes":[]}` místo 4xx. Injekce to není (dotaz je parametrizovaný), ale
 * neplatný vstup se má odmítnout. Navíc volná kontrola `[0-9a-f-]{36}` pustila 36 pomlček až do
 * SQL (uuid cast → 500).
 *
 * Po opravě: neplatné ID → 400 INVALID_EVENT_ID (tělo dál nese `ticketTypes: []` — volající
 * v UI/embedu/mobilu to tak čtou); platné UUID neexistující akce → 200 []; existující → 200 s typy.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx: unknown) => Promise<Response>;

run('Krok 4 (kolo 3) — K8a: neplatné ID akce → 4xx', () => {
  let clone: LocalClone;
  beforeAll(async () => { clone = await createLocalClone(); }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 30_000);

  const get = async (id: string) => {
    const { GET } = await import('@/app/api/events/[id]/ticket-types/route');
    return throughMiddleware(new Request(`http://localhost/api/events/${encodeURIComponent(id)}/ticket-types`), GET as H, { params: { id } });
  };

  it("SQLi řetězec \"1' OR '1'='1\" → 400 INVALID_EVENT_ID", async () => {
    const r = await get("1' OR '1'='1");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'INVALID_EVENT_ID', ticketTypes: [] });
  });
  it('36 pomlček / ne-UUID tvar → 400 (ne 500 z uuid castu)', async () => {
    expect((await get('-'.repeat(36))).status).toBe(400);
    expect((await get('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).status).toBe(400);
  });
  it('platné UUID neexistující akce → 200 []; existující publikovaná → 200 s typy', async () => {
    const none = await get('00000000-0000-4000-8000-000000000000');
    expect(none.status).toBe(200);
    expect(((await none.json()) as { ticketTypes: unknown[] }).ticketTypes).toEqual([]);
    const c = await clone.seed.chain();
    const ok = await get(c.eventId);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { ticketTypes: Array<{ id: string }> }).ticketTypes.map((t) => t.id)).toContain(c.ticketTypeId);
  });
});
