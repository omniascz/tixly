/**
 * Golden Path: Saalplan Click&View (DACH P2-6, Reservix exclusive)
 *
 * Promotér nahraje URL fotek pohledu z jednotlivých sedadel, buyer endpoint
 * vrátí mapu { seatId: { photoUrl } } pro seat picker UI.
 *
 * Flow:
 *   1) Najdi seated event s alespoň 2 event_seats
 *   2) POST /api/admin/events/[id]/view-photos s {photos:[{eventSeatId, photoUrl, caption}]}
 *   3) GET /api/admin/events/[id]/view-photos → ověř withPhoto count
 *   4) GET /api/events/[id]/seat-view-photos → public, vrátí photos map
 *   5) Re-POST se updates → upsert, ne duplicates
 *   6) Validation: foreign event_seat → 422 SEAT_NOT_IN_EVENT
 */
import { test, expect, type BrowserContext } from '@playwright/test';

// Divadlo Verze má seated venue (Celetná 117 míst) — admin@tixly.cz nemá
// žádné seated eventy. Promotér seed memory potvrzuje.
const PROMOTER_EMAIL = 'verze@divadlovceletne.cz';
const PROMOTER_PASSWORD = 'Demo2026!';

async function apiLogin(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await context.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed: ${await res.text()}`);
  }
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function findSeatedEvent(
  context: BrowserContext,
  token: string,
): Promise<{ eventId: string; seatIds: string[] }> {
  const r = await context.request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await r.json()) as
    | Array<{ id: string }>
    | { events?: Array<{ id: string }> };
  const events = Array.isArray(body) ? body : (body.events ?? []);
  for (const ev of events) {
    const sr = await context.request.get(
      `/api/admin/events/${ev.id}/view-photos`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!sr.ok()) continue;
    const sb = (await sr.json()) as {
      total: number;
      seats: Array<{ eventSeatId: string }>;
    };
    if (sb.total >= 2) {
      return {
        eventId: ev.id,
        seatIds: sb.seats.slice(0, 3).map((s) => s.eventSeatId),
      };
    }
  }
  throw new Error('No seated event with 2+ event_seats found in demo DB');
}

test('Click&View: promotér uploadne URL, buyer GET map se vrátí', async ({
  context,
}) => {
  const token = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const { eventId, seatIds } = await findSeatedEvent(context, token);
  expect(seatIds.length).toBeGreaterThanOrEqual(2);

  await test.step('1. POST view-photos s 2 URLs', async () => {
    const r = await context.request.post(
      `/api/admin/events/${eventId}/view-photos`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: {
          photos: [
            {
              eventSeatId: seatIds[0],
              photoUrl: 'https://example.cdn/view/seat-1.jpg',
              caption: 'Pohled z prvního sedadla',
            },
            {
              eventSeatId: seatIds[1],
              photoUrl: 'https://example.cdn/view/seat-2.jpg',
            },
          ],
        },
      },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { upserted: number };
    expect(body.upserted).toBe(2);
  });

  await test.step('2. GET admin view-photos → withPhoto >= 2', async () => {
    const r = await context.request.get(
      `/api/admin/events/${eventId}/view-photos`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      total: number;
      withPhoto: number;
      seats: Array<{ eventSeatId: string; photoUrl: string | null; caption: string | null }>;
    };
    expect(body.withPhoto).toBeGreaterThanOrEqual(2);
    const seat0 = body.seats.find((s) => s.eventSeatId === seatIds[0]);
    expect(seat0?.photoUrl).toBe('https://example.cdn/view/seat-1.jpg');
    expect(seat0?.caption).toBe('Pohled z prvního sedadla');
  });

  await test.step('3. GET public seat-view-photos → photos map', async () => {
    const r = await context.request.get(
      `/api/events/${eventId}/seat-view-photos`,
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      count: number;
      photos: Record<string, { photoUrl: string }>;
    };
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.photos[seatIds[0]]?.photoUrl).toBe(
      'https://example.cdn/view/seat-1.jpg',
    );
    expect(body.photos[seatIds[1]]?.photoUrl).toBe(
      'https://example.cdn/view/seat-2.jpg',
    );
  });

  await test.step('4. Re-POST s update → upsert, ne duplicates', async () => {
    const r = await context.request.post(
      `/api/admin/events/${eventId}/view-photos`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: {
          photos: [
            {
              eventSeatId: seatIds[0],
              photoUrl: 'https://example.cdn/view/seat-1-NEW.jpg',
              caption: 'Updated',
            },
          ],
        },
      },
    );
    expect(r.status()).toBe(200);

    // Verify update applied (ne duplicate)
    const after = await context.request.get(
      `/api/events/${eventId}/seat-view-photos`,
    );
    const body = (await after.json()) as {
      photos: Record<string, { photoUrl: string; caption: string | null }>;
    };
    expect(body.photos[seatIds[0]]?.photoUrl).toBe(
      'https://example.cdn/view/seat-1-NEW.jpg',
    );
    expect(body.photos[seatIds[0]]?.caption).toBe('Updated');
  });
});

test('Click&View: foreign event_seat_id → 422 SEAT_NOT_IN_EVENT', async ({
  context,
}) => {
  const token = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const { eventId } = await findSeatedEvent(context, token);

  // Random UUID nepatřící k tomuto eventu
  const r = await context.request.post(
    `/api/admin/events/${eventId}/view-photos`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: {
        photos: [
          {
            eventSeatId: '00000000-0000-0000-0000-000000000000',
            photoUrl: 'https://example.cdn/x.jpg',
          },
        ],
      },
    },
  );
  expect(r.status()).toBe(422);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('SEAT_NOT_IN_EVENT');
});

test('Click&View: invalid event_id v public endpoint → 400/404', async ({
  context,
}) => {
  const r = await context.request.get(
    '/api/events/00000000-0000-0000-0000-000000000000/seat-view-photos',
  );
  expect(r.status()).toBe(404);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('EVENT_NOT_FOUND');
});
