/**
 * Golden Path: Promotér vytvoří NOVÝ event v existujícím sále → buyer ho koupí.
 *
 * Verifikuje opravu P0 bug ze session 13: POST /api/admin/events teď volá
 * `copyLayoutToEventSeats(client, eventId)` po insertu ticket_types, takže
 * buyer SeatPicker dostane sedadla.
 *
 * Bez fixu by tento spec selhal v kroku "Buyer dostane sedadla" — stará
 * implementace vracela layout, ale `seats: []`.
 *
 * Předpoklady:
 *   - Stará střelnice venue má active seating chart se 4 sektory
 *     (PŘÍZEMÍ, BALKON STŘED, BALKON VLEVO, BALKON VPRAVO)
 *   - theatre@hranice.cz má active promoter membership
 *   - Heslo Demo2026!
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const STARA_STRELNICE_VENUE = 'ba5a2248-c11c-42ec-85fe-63929f4d4f3f';

test('Promotér vytvoří seated event přes API → buyer dostane sedadla', async ({
  baseURL,
}) => {
  const ctx = await pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  });

  // 1. Login jako promotér theatre@hranice.cz → cookies uložené v ctx
  const loginRes = await ctx.post('/api/auth/login', {
    data: { email: 'theatre@hranice.cz', password: 'Demo2026!' },
  });
  expect(loginRes.status(), 'Login OK').toBe(200);

  // 2. POST /api/admin/events s ticket_types napojené na sektory přes `zone`.
  //    Cílíme stejné sektory co má layout Staré střelnice.
  const dateStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30 dní
  const dateEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
  const createRes = await ctx.post('/api/admin/events', {
    data: {
      title: `PWT Test Drama ${Date.now()}`,
      description: 'Playwright test drama — automatický spec, smaž po runu.',
      category: 'theatre',
      eventType: 'theatre',
      dateStart,
      dateEnd,
      venueId: STARA_STRELNICE_VENUE,
      currency: 'CZK',
      ticketTypes: [
        { name: 'Přízemí', priceHalire: 35000, capacity: 232, zone: 'PŘÍZEMÍ', isSeated: true },
        { name: 'Balkon střed', priceHalire: 28000, capacity: 45, zone: 'BALKON STŘED', isSeated: true },
        { name: 'Balkon vlevo', priceHalire: 22000, capacity: 16, zone: 'BALKON VLEVO', isSeated: true },
        { name: 'Balkon vpravo', priceHalire: 22000, capacity: 15, zone: 'BALKON VPRAVO', isSeated: true },
      ],
      publishImmediately: true,
    },
  });
  const createBody = await createRes.json();
  expect(createRes.status(), `Create event OK (got ${JSON.stringify(createBody)})`).toBe(201);
  expect(createBody.eventId).toBeTruthy();

  // 3. P0 verification: copyLayoutToEventSeats vrátil > 0 vyrobených sedadel
  expect(createBody.sectorsMapped, 'všechny 4 sektory zmapovány na ticket_types').toBe(4);
  expect(createBody.seatsCreated, 'event_seats naplněné — Stará střelnice má 308 sedadel').toBe(308);
  expect(createBody.sectorsSkipped, 'žádný sektor nepřeskočen').toEqual([]);

  const eventId = createBody.eventId;

  // 4. Event je obvykle pending_review (AI gate / first-time promoter).
  //    Master admin ho schválí — to je krok 6→7 v promotér flow.
  if (createBody.status !== 'published') {
    const adminCtx = await pwRequest.newContext({
      baseURL,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
    const adminLogin = await adminCtx.post('/api/auth/login', {
      data: { email: 'superadmin@tixly.cz', password: 'Demo2026!' },
    });
    expect(adminLogin.status(), 'Platform admin login OK').toBe(200);

    const approveRes = await adminCtx.post(`/api/platform/moderation/${eventId}/approve`);
    expect(approveRes.status(), 'Moderation approve OK').toBe(200);

    await adminCtx.dispose();
  }

  // 5. Buyer (anon ctx, žádné cookies) dostane mapu se 308 sedadly
  const buyerCtx = await pwRequest.newContext({ baseURL });
  const seatsRes = await buyerCtx.get(`/api/events/${eventId}/seats`);
  expect(seatsRes.status(), 'Buyer GET seats OK').toBe(200);
  const seatsBody = await seatsRes.json();
  expect(seatsBody.seats.length, 'buyer vidí 308 sedadel').toBe(308);
  expect(seatsBody.ticketTypes.length, '4 ticket types z 4 sektorů').toBe(4);

  await buyerCtx.dispose();
  await ctx.dispose();
});
