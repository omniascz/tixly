// @vitest-environment node
/**
 * Kolo 8 / krok 1 — inscenace (karta zadaná jednou) a termíny.
 *
 * Očekávané:
 *   - pořadatel založí inscenaci s kartou (podtitul, popis, autor, režie, obsazení, délka, přestávka, věk, žánr, fotky, video);
 *   - nový termín = inscenace + sál + datum: ceník převzatý z předchozího termínu (ceny, zóny, sazby DPH),
 *     sedadla zkopírovaná z plánku sálu, údaje z inscenace; termín smí doplnit poznámku a alternaci;
 *   - první termín jde do moderace, další termín schválené inscenace se publikuje rovnou;
 *   - veřejně: stránka inscenace se všemi budoucími publikovanými termíny (město, sál, datum, obsazenost),
 *     program podle měst s filtrem město + měsíc; změna karty se promítne do termínů;
 *   - cizí pořadatel inscenaci nevidí ani k ní nezaloží termín.
 */
import type { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalClone, hasLocalDb, type LocalClone } from './helpers/local-fixture';
import { throughMiddleware } from './helpers/through-middleware';

const run = describe.skipIf(!hasLocalDb);
type H = (r: NextRequest, ctx?: unknown) => Promise<Response>;

const LAYOUT = {
  viewBox: '0 0 400 300',
  sectors: [
    { name: 'Přízemí', color: '#7c3aed', rows: [1, 2].map((r) => ({ label: String(r), seats: [1, 2, 3, 4, 5].map((n) => ({ num: String(n), x: n * 20, y: r * 20 })) })) },
    { name: 'Balkon', color: '#0ea5e9', rows: [{ label: '1', seats: [1, 2, 3].map((n) => ({ num: String(n), x: n * 20, y: 100 })) }] },
  ],
};

run('Kolo 8 — inscenace a termíny', () => {
  let clone: LocalClone;
  let ownerTok: string;
  let c: Awaited<ReturnType<LocalClone['seed']['chain']>>;
  const venues: { praha: string; brno: string } = { praha: '', brno: '' };

  const tokenFor = async (userId: string, promoterId: string) => {
    const { signAccessToken } = await import('@/lib/auth');
    const email = (await clone.pool.query(`SELECT email FROM identity.users WHERE id=$1`, [userId])).rows[0].email;
    return signAccessToken({ id: userId, email, name: 'U' } as never, {
      isPlatformAdmin: false, promoterMemberships: [{ promoterId, slug: 'x', name: 'x', status: 'active', role: 'owner' }],
    } as never);
  };
  const call = async (method: string, url: string, mod: () => Promise<Record<string, unknown>>, body?: unknown, tok?: string, ctx: unknown = {}) => {
    const m = await mod();
    const r = await throughMiddleware(new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), m[method] as H, ctx);
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text };
  };
  const prodRoute = () => import('@/app/api/admin/productions/route');
  const prodIdRoute = () => import('@/app/api/admin/productions/[id]/route');
  const termsRoute = () => import('@/app/api/admin/productions/[id]/terms/route');

  async function venueWithChart(city: string, name: string) {
    const v = (await clone.pool.query<{ id: string }>(
      `INSERT INTO catalog.venues (name, address, city, country, capacity, venue_type, promoter_id, created_at)
       VALUES ($1, 'Hlavní 1', $2, 'CZ', 13, 'theatre_hall', $3, now()) RETURNING id`, [name, city, c.promoterId])).rows[0].id;
    await clone.pool.query(
      `INSERT INTO catalog.venue_seating_charts (venue_id, name, layout, total_seats, active) VALUES ($1, 'Plánek', $2::jsonb, 13, true)`,
      [v, JSON.stringify(LAYOUT)]);
    return v;
  }

  beforeAll(async () => {
    clone = await createLocalClone();
    c = await clone.seed.chain();
    ownerTok = await tokenFor(c.adminUserId, c.promoterId);
    venues.praha = await venueWithChart(`Praha-${Date.now()}`, 'Divadlo Na Jihu – velký sál');
    venues.brno = await venueWithChart(`Brno-${Date.now()}`, 'Kulturní dům – sál');
  }, 120_000);
  afterAll(async () => { await clone?.cleanup(); }, 60_000);

  const card = {
    title: 'Racek', subtitle: 'Komedie o čtyřech dějstvích', description: 'Čechovova hra o lásce a umění.',
    author: 'A. P. Čechov', director: 'Jana Nováková', cast: [{ role: 'Nina', name: 'Eva Svobodová' }, { role: 'Treplev', name: 'Petr Malý' }],
    durationMin: 150, intermissionMin: 20, ageRating: '12+', genre: 'činohra',
    photos: ['https://example.test/racek1.jpg'], videoUrl: 'https://example.test/racek-trailer',
  };

  let productionId = '';
  let firstTerm = '';

  it('inscenace s kartou se uloží a vrátí', async () => {
    const r = await call('POST', '/api/admin/productions', prodRoute, card, ownerTok);
    expect(r.status, r.text).toBe(201);
    productionId = (r.json.production as { id: string }).id;
    const g = await call('GET', `/api/admin/productions/${productionId}`, prodIdRoute, undefined, ownerTok, { params: { id: productionId } });
    expect(g.status, g.text).toBe(200);
    expect(g.json.production).toMatchObject({
      title: 'Racek', subtitle: card.subtitle, author: card.author, director: card.director, durationMin: 150, intermissionMin: 20,
      ageRating: '12+', genre: 'činohra', cast: card.cast, photos: card.photos, videoUrl: card.videoUrl,
    });
  });

  it('první termín: ceník zadaný ručně, sedadla z plánku sálu, údaje z inscenace, moderace', async () => {
    const r = await call('POST', `/api/admin/productions/${productionId}/terms`, termsRoute, {
      venueId: venues.praha, dateStart: '2027-03-10T19:00:00+01:00',
      ticketTypes: [
        { name: 'Přízemí', priceHalire: 45000, zone: 'Přízemí', vatRateCode: 'CZ_REDUCED' },
        { name: 'Balkon', priceHalire: 30000, zone: 'Balkon', vatRateCode: 'CZ_REDUCED' },
      ],
    }, ownerTok, { params: { id: productionId } });
    expect(r.status, r.text).toBe(201);
    expect(r.json).toMatchObject({ status: 'pending_review', ticketTypes: 2, seats: 13 });
    firstTerm = r.json.eventId as string;
    const ev = (await clone.pool.query(
      `SELECT title, description, production_id, min_age, category, date_end FROM catalog.events WHERE id=$1`, [firstTerm])).rows[0];
    expect(ev).toMatchObject({ title: 'Racek', description: card.description, production_id: productionId, min_age: 12, category: 'theatre' });
    expect(new Date(ev.date_end).getTime() - new Date('2027-03-10T19:00:00+01:00').getTime()).toBe(150 * 60_000);
    const caps = (await clone.pool.query(`SELECT name, total_qty FROM catalog.ticket_types WHERE event_id=$1 ORDER BY name`, [firstTerm])).rows;
    expect(caps).toEqual([{ name: 'Balkon', total_qty: 3 }, { name: 'Přízemí', total_qty: 10 }]);
    // moderace schválí první termín
    await clone.pool.query(`UPDATE catalog.events SET status='published' WHERE id=$1`, [firstTerm]);
  });

  it('další termín na pár kliknutí: ceník převzatý z předchozího termínu, publikuje se rovnou; termín smí jen doplnit', async () => {
    const r = await call('POST', `/api/admin/productions/${productionId}/terms`, termsRoute, {
      venueId: venues.brno, dateStart: '2027-04-02T18:00:00+02:00', copyPricingFromEventId: firstTerm,
      termNote: 'Představení s českými titulky', castAlternation: 'Nina: Lucie Bílá',
    }, ownerTok, { params: { id: productionId } });
    expect(r.status, r.text).toBe(201);
    expect(r.json).toMatchObject({ status: 'published', ticketTypes: 2, seats: 13 });
    const id = r.json.eventId as string;
    const tts = (await clone.pool.query(`SELECT name, base_price, zone, vat_rate_code FROM catalog.ticket_types WHERE event_id=$1 ORDER BY base_price DESC`, [id])).rows;
    expect(tts).toEqual([
      { name: 'Přízemí', base_price: 45000, zone: 'Přízemí', vat_rate_code: 'CZ_REDUCED' },
      { name: 'Balkon', base_price: 30000, zone: 'Balkon', vat_rate_code: 'CZ_REDUCED' },
    ]);
    expect((await clone.pool.query(`SELECT term_note, cast_alternation FROM catalog.events WHERE id=$1`, [id])).rows[0])
      .toEqual({ term_note: 'Představení s českými titulky', cast_alternation: 'Nina: Lucie Bílá' });
  });

  it('veřejná stránka inscenace: karta + budoucí publikované termíny s městem, sálem a obsazeností; změna karty se promítne', async () => {
    // prodané místo v prvním termínu → obsazenost
    await clone.pool.query(`UPDATE catalog.event_seats SET status='sold' WHERE id = (SELECT id FROM catalog.event_seats WHERE event_id=$1 LIMIT 1)`, [firstTerm]);
    // termín v minulosti a neschválený termín se nezobrazí
    const past = await call('POST', `/api/admin/productions/${productionId}/terms`, termsRoute,
      { venueId: venues.praha, dateStart: '2025-01-01T19:00:00+01:00', copyPricingFromEventId: firstTerm }, ownerTok, { params: { id: productionId } });
    expect(past.status, past.text).toBe(201);
    const p = await call('PATCH', `/api/admin/productions/${productionId}`, prodIdRoute, { description: 'Nový popis inscenace.' }, ownerTok, { params: { id: productionId } });
    expect(p.status, p.text).toBe(200);

    const pub = await call('GET', `/api/public/productions/${productionId}`, () => import('@/app/api/public/productions/[id]/route'), undefined, undefined, { params: { id: productionId } });
    expect(pub.status, pub.text).toBe(200);
    expect(pub.json.production).toMatchObject({ title: 'Racek', description: 'Nový popis inscenace.', director: card.director, cast: card.cast });
    const terms = pub.json.terms as Array<{ eventId: string; city: string; venueName: string; dateStart: string; capacity: number; sold: number; occupancyPct: number }>;
    expect(terms.map((t) => t.city)).toEqual([expect.stringMatching(/^Praha-/), expect.stringMatching(/^Brno-/)]);
    expect(terms[0]).toMatchObject({ eventId: firstTerm, venueName: 'Divadlo Na Jihu – velký sál', capacity: 13, sold: 1, occupancyPct: 8 });
  });

  it('program podle měst: filtr město + měsíc', async () => {
    const city = (await clone.pool.query(`SELECT city FROM catalog.venues WHERE id=$1`, [venues.brno])).rows[0].city;
    const route = () => import('@/app/api/public/program/route');
    const all = await call('GET', `/api/public/program?month=2027-04`, route);
    expect(all.status, all.text).toBe(200);
    const cities = all.json.cities as Array<{ city: string; events: Array<{ productionId: string | null; title: string; venueName: string }> }>;
    const brno = cities.find((x) => x.city === city);
    expect(brno?.events).toEqual([expect.objectContaining({ productionId, title: 'Racek', venueName: 'Kulturní dům – sál' })]);
    const filtered = await call('GET', `/api/public/program?city=${encodeURIComponent(city)}&month=2027-03`, route);
    expect(filtered.json.cities).toEqual([]);
    const ok = await call('GET', `/api/public/program?city=${encodeURIComponent(city)}`, route);
    expect((ok.json.cities as unknown[]).length).toBe(1);
  });

  it('cizí pořadatel inscenaci nevidí a termín k ní nezaloží (ani do cizího sálu)', async () => {
    const other = await clone.seed.chain();
    const tok = await tokenFor(other.adminUserId, other.promoterId);
    expect((await call('GET', `/api/admin/productions/${productionId}`, prodIdRoute, undefined, tok, { params: { id: productionId } })).status).toBe(404);
    expect((await call('POST', `/api/admin/productions/${productionId}/terms`, termsRoute,
      { venueId: venues.praha, dateStart: '2027-05-01T19:00:00+02:00', copyPricingFromEventId: firstTerm }, tok, { params: { id: productionId } })).status).toBe(404);
    const own = await call('POST', '/api/admin/productions', prodRoute, { title: 'Cizí' }, tok);
    const ownId = (own.json.production as { id: string }).id;
    const r = await call('POST', `/api/admin/productions/${ownId}/terms`, termsRoute,
      { venueId: venues.praha, dateStart: '2027-05-01T19:00:00+02:00', ticketTypes: [{ name: 'X', priceHalire: 100, capacity: 5, vatRateCode: 'CZ_REDUCED' }] }, tok, { params: { id: ownId } });
    expect(r.status, r.text).toBe(404);
    expect(r.json.error).toBe('VENUE_NOT_FOUND');
  });
});
