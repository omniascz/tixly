/**
 * public-routes.live.test.ts — verejne routy pod produkcni roli tixly_app.
 *
 * discover a artists/[slug] nikoho neautentizuji, takze GUC nemaji z ceho vzit
 * a RLS jim pod tixly_app odfiltrovalo VSECHNO (FINDINGS 91). Bezi proto
 * v servisnim kontextu — a tim padem MUSI filtrovat samy:
 *   - jen e.status = 'published'
 *   - jen tt.visibility = 'public'
 * Bez toho by oprava zverejnila drafty a skryte typy listku.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { createLiveClone, hasNeonKey, type LiveClone } from './helpers/live-fixture';

const d = hasNeonKey ? describe : describe.skip;
let clone: LiveClone;

const ids = {
  user: randomUUID(), promoter: randomUUID(), venue: randomUUID(),
  pubEvent: randomUUID(), draftEvent: randomUUID(),
  pubType: randomUUID(), hiddenType: randomUUID(),
  artist: randomUUID(),
  hotel: randomUUID(), room: randomUUID(),
  pubPkg: randomUUID(), draftPkg: randomUUID(),
};
const PUB_TITLE = `PUB-${ids.pubEvent.slice(0, 8)}`;
const DRAFT_TITLE = `DRAFT-${ids.draftEvent.slice(0, 8)}`;
const ARTIST_SLUG = `art-${ids.artist.slice(0, 8)}`;

d('verejne routy pod tixly_app', () => {
  beforeAll(async () => {
    clone = await createLiveClone('public-routes');
    const q = (s: string, p: unknown[] = []) => clone.pool.query(s, p);
    await q("INSERT INTO identity.users (id,email,name,gdpr_consent_at) VALUES ($1,$2,'U',now())",
      [ids.user, `pr_${ids.user.slice(0, 8)}@t.cz`]);
    await q("INSERT INTO platform.promoters (id,name,email) VALUES ($1,'P',$2)",
      [ids.promoter, `p_${ids.promoter.slice(0, 8)}@t.cz`]);
    await q("INSERT INTO catalog.venues (id,name,city,country,capacity) VALUES ($1,'V','Praha','CZ',100)",
      [ids.venue]);
    for (const [id, title, status] of [
      [ids.pubEvent, PUB_TITLE, 'published'],
      [ids.draftEvent, DRAFT_TITLE, 'draft'],
    ] as const) {
      await q(`INSERT INTO catalog.events
                 (id,promoter_id,organizer_id,venue_id,title,date_start,slug,status)
               VALUES ($1,$2,$3,$4,$5,now()+interval '30 day',$6,$7)`,
        [id, ids.promoter, ids.user, ids.venue, title, `ev-${String(id).slice(0, 8)}`, status]);
    }
    // verejny i skryty typ listku na PUBLIKOVANE akci
    await q(`INSERT INTO catalog.ticket_types
               (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'GA','standing',50000,100,100,'public')`,
      [ids.pubType, ids.pubEvent]);
    await q(`INSERT INTO catalog.ticket_types
               (id,event_id,name,kind,base_price,total_qty,remaining_qty,visibility)
             VALUES ($1,$2,'SECRET','standing',1,100,100,'hidden')`,
      [ids.hiddenType, ids.pubEvent]);
    // lineups.artists ma NOT NULL event_id + promoter_id
    await q(`INSERT INTO lineups.artists (id,event_id,promoter_id,name,slug)
             VALUES ($1,$2,$3,'Artist',$4)`,
      [ids.artist, ids.pubEvent, ids.promoter, ARTIST_SLUG])
      .catch((e) => console.log('artist seed:', e.code, e.message.slice(0, 80)));

    // R-13: aktivni balicek na OBOU akcich — na publikovane i na draftu.
    // Draft musi zustat neviditelny; vsechny ostatni filtry (active, kapacita)
    // jsou schvalne splnene, aby rozhodoval vyhradne stav akce.
    await q("INSERT INTO catalog.travel_hotels (id,name,city,stars) VALUES ($1,'Hotel','Praha',4)",
      [ids.hotel]);
    await q(`INSERT INTO catalog.travel_hotel_rooms (id,hotel_id,name,capacity,price_per_night_halire)
             VALUES ($1,$2,'Dvouluzko',2,250000)`, [ids.room, ids.hotel]);
    for (const [pkgId, evId] of [
      [ids.pubPkg, ids.pubEvent], [ids.draftPkg, ids.draftEvent],
    ] as const) {
      await q(`INSERT INTO catalog.event_travel_packages
                 (id,event_id,hotel_id,hotel_room_id,checkin_date,checkout_date,total_capacity)
               VALUES ($1,$2,$3,$4,current_date+30,current_date+32,10)`,
        [pkgId, evId, ids.hotel, ids.room]);
    }
  }, 180_000);

  afterAll(async () => { await clone?.cleanup(); }, 120_000);

  it('discover vraci publikovanou akci (drive prazdno pod tixly_app)', async () => {
    const { GET } = await import('@/app/api/discover/route');
    const res = await GET(new NextRequest('http://localhost:3000/api/discover') as never);
    const body = await res.json() as { events?: Array<{ title: string; min_price_halire: number | null }> };
    const titles = (body.events ?? []).map((e) => e.title);
    console.log('[discover]', res.status, 'akci:', titles.length);
    expect(res.status).toBe(200);
    expect(titles).toContain(PUB_TITLE);
  }, 120_000);

  it('discover NEvraci draft akci', async () => {
    const { GET } = await import('@/app/api/discover/route');
    const res = await GET(new NextRequest('http://localhost:3000/api/discover') as never);
    const body = await res.json() as { events?: Array<{ title: string }> };
    expect((body.events ?? []).map((e) => e.title)).not.toContain(DRAFT_TITLE);
  }, 120_000);

  it('discover NEpropusti cenu skryteho typu listku do min_price', async () => {
    const { GET } = await import('@/app/api/discover/route');
    const res = await GET(new NextRequest('http://localhost:3000/api/discover') as never);
    const body = await res.json() as { events?: Array<{ title: string; min_price_halire: number | null }> };
    const ev = (body.events ?? []).find((e) => e.title === PUB_TITLE);
    expect(ev).toBeDefined();
    // skryty typ ma cenu 1; verejny 50000 — min musi byt 50000
    expect(Number(ev!.min_price_halire)).toBe(50000);
  }, 120_000);

  it('artists/[slug] vraci umelce (drive 404 z prazdneho vysledku)', async () => {
    const { GET } = await import('@/app/api/artists/[slug]/route');
    const res = await GET(
      new Request(`http://localhost:3000/api/artists/${ARTIST_SLUG}`) as never,
      { params: { slug: ARTIST_SLUG } } as never);
    console.log('[artists]', res.status);
    expect(res.status).toBe(200);
  }, 120_000);

  // ── R-13 / FINDINGS 97 ────────────────────────────────────────────────────
  const travel = async (eventId: string) => {
    const { GET } = await import('@/app/api/events/[id]/travel-packages/route');
    const res = await GET(
      new NextRequest(`http://localhost:3000/api/events/${eventId}/travel-packages`) as never,
      { params: { id: eventId } } as never);
    const body = await res.json() as { packages?: unknown[] };
    return { status: res.status, count: (body.packages ?? []).length };
  };

  it('RED: puvodni dotaz BEZ JOINu na events vydal balicek draft akce', async () => {
    // Presna kopie WHERE z routy pred opravou — dokazuje, ze unik existoval
    // a ze ho nezachytil zadny z ostatnich filtru.
    const r = await clone.pool.query(
      `SELECT p.id FROM catalog.event_travel_packages p
         JOIN catalog.travel_hotels h ON h.id = p.hotel_id
         JOIN catalog.travel_hotel_rooms r ON r.id = p.hotel_room_id
        WHERE p.event_id = $1 AND p.active AND h.active AND r.active
          AND (p.total_capacity = 0 OR p.reserved_count < p.total_capacity)`,
      [ids.draftEvent]);
    console.log('[R-13 RED] draft bez JOINu:', r.rowCount, 'radku');
    expect(r.rowCount).toBe(1);
  }, 120_000);

  it('GREEN: routa NEvyda balicky draft akce', async () => {
    const out = await travel(ids.draftEvent);
    console.log('[R-13 GREEN draft]', out);
    expect(out.status).toBe(200);
    expect(out.count).toBe(0);
  }, 120_000);

  it('GREEN: routa porad vydava balicky publikovane akce', async () => {
    const out = await travel(ids.pubEvent);
    console.log('[R-13 GREEN pub]', out);
    expect(out.status).toBe(200);
    expect(out.count).toBe(1);
  }, 120_000);

  // ── domereni 3 zbylych rout: events/[id]/alert ────────────────────────────
  // Katalog predpovida PAD: INSERT ma RETURNING token, takze plati SELECT
  // policy ticket_alerts_select. Po 455 zni jeji treti vetev
  //   (app_current_user_id())::text = ''
  // coz je uuid — nikdy se nerovna prazdnemu retezci. Pro anonyma tedy
  // neplati zadna vetev. Predpoved neni mereni; merim.
  const alert = async (headers: Record<string, string>) => {
    const { POST } = await import('@/app/api/events/[id]/alert/route');
    const res = await POST(
      new NextRequest(`http://localhost:3000/api/events/${ids.pubEvent}/alert`,
        { method: 'POST', headers, body: JSON.stringify({ email: `al_${randomUUID().slice(0, 8)}@t.cz` }) }) as never,
      { params: { id: ids.pubEvent } } as never);
    return { status: res.status, body: (await res.text()).slice(0, 120) };
  };

  it('alert: anonymni prihlaseni k hlidacimu psu', async () => {
    const out = await alert({ 'content-type': 'application/json' });
    console.log('[alert anonym]', out);
    expect(out.status).toBeLessThan(500);
  }, 120_000);

  it('alert: prihlaseny uzivatel', async () => {
    const out = await alert({ 'content-type': 'application/json', 'x-user-id': ids.user });
    console.log('[alert user]', out);
    expect(out.status).toBeLessThan(500);
  }, 120_000);
});
