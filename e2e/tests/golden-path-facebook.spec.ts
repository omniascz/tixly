/**
 * Golden Path: Facebook Event 1-click publish (DACH parity #7, mock mode)
 *
 * Plnou mock implementaci (FACEBOOK_APP_ID v env není nastavený). SDK vrací
 * deterministic fake responses — fb_page_id `page-{hex}`, fb_event_id
 * `event-{hex}`. Pro produkci přidat Meta App credentials + projít App Review
 * (~2-4 týdny).
 *
 * Flow:
 *   1. Promotér klikne "Napojit Facebook" → GET /oauth/start → redirectUrl
 *   2. GET redirectUrl (mock callback s mock code) → exchange + listUserPages
 *      → ON CONFLICT insert/update 2 fake pages
 *   3. GET /api/admin/facebook/pages → 2 pages s is_mock=true
 *   4. POST /api/admin/events/[id]/publish-facebook → mock createPageEvent
 *      → fb_event_id, permalinkUrl, DB ledger row
 *   5. Re-publish stejný event → alreadyPublished=true (idempotent)
 *   6. POST /pages/[pageId]/disconnect → soft delete (disconnected_at)
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const PROMOTER_EMAIL = 'admin@tixly.cz';
const PROMOTER_PASSWORD = 'Demo2026!';

async function presetCookieConsent(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'tixly.cookie-consent',
        JSON.stringify({
          essential: true,
          analytics: false,
          marketing: false,
          decidedAt: new Date().toISOString(),
        }),
      );
    } catch {
      /* noop */
    }
  });
}

async function apiLogin(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<string> {
  const res = await context.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (res.status() !== 200) {
    throw new Error(`Login failed for ${email} (${res.status()}): ${await res.text()}`);
  }
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test('Facebook: OAuth napojení → publish → idempotent re-publish → disconnect', async ({
  context,
  request,
}) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const authHeaders = {
    Authorization: `Bearer ${promoterToken}`,
    'Content-Type': 'application/json',
  };

  // Cleanup před testem — disconnect všech existujících pages (idempotent).
  const initialList = await request.get('/api/admin/facebook/pages', {
    headers: authHeaders,
  });
  if (initialList.ok()) {
    const { pages } = (await initialList.json()) as {
      pages: Array<{ id: string }>;
    };
    for (const p of pages) {
      await request.post(`/api/admin/facebook/pages/${p.id}/disconnect`, {
        headers: authHeaders,
      });
    }
  }

  // 1. OAuth start → redirectUrl (mock vrací URL s code+state už uvnitř)
  let redirectUrl = '';
  await test.step('1. OAuth start vrátí mock redirectUrl', async () => {
    const r = await request.get('/api/admin/facebook/oauth/start', {
      headers: authHeaders,
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      redirectUrl: string;
      isMock: boolean;
      state: string;
    };
    expect(body.isMock).toBe(true);
    expect(body.redirectUrl).toContain('/api/admin/facebook/oauth/callback');
    expect(body.redirectUrl).toContain('code=mock-code-');
    expect(body.redirectUrl).toContain('state=');
    redirectUrl = body.redirectUrl;
  });

  // 2. Volat mock callback s code+state → 302 redirect na /admin/facebook?connected=2
  await test.step('2. OAuth callback → 2 pages saved', async () => {
    const r = await request.get(redirectUrl, {
      headers: { Authorization: `Bearer ${promoterToken}` },
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect(r.status()).toBe(302);
    const location = r.headers()['location'];
    expect(location).toContain('/admin/facebook?connected=2');
    expect(location).toContain('mock=1');
  });

  // 3. Pages list → 2 napojené pages s is_mock=true
  let pageId = '';
  await test.step('3. Pages list vrátí napojené pages', async () => {
    const r = await request.get('/api/admin/facebook/pages', {
      headers: authHeaders,
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      mockMode: boolean;
      pages: Array<{ id: string; fbPageId: string; name: string; isMock: boolean }>;
    };
    expect(body.mockMode).toBe(true);
    expect(body.pages.length).toBe(2);
    expect(body.pages.every((p) => p.isMock)).toBe(true);
    pageId = body.pages[0].id;
  });

  // 4. Najdi event v Demo Promoter portfolio
  let eventId = '';
  await test.step('4. Najít event pro publish', async () => {
    const r = await request.get('/api/admin/events', { headers: authHeaders });
    const body = (await r.json()) as
      | Array<{ id: string }>
      | { events?: Array<{ id: string }> };
    const events = Array.isArray(body) ? body : (body.events ?? []);
    expect(events.length).toBeGreaterThan(0);
    eventId = events[0].id;
  });

  // 5. Publish na FB
  let fbEventId = '';
  await test.step('5. Publish na FB → mock fb_event_id + permalinkUrl', async () => {
    const r = await request.post(`/api/admin/events/${eventId}/publish-facebook`, {
      headers: authHeaders,
      data: { pageId },
    });
    if (r.status() !== 200) {
      throw new Error(`Publish failed: ${r.status()} ${await r.text()}`);
    }
    const body = (await r.json()) as {
      ok: boolean;
      alreadyPublished: boolean;
      fbEventId: string;
      permalinkUrl: string;
      isMock: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.alreadyPublished).toBe(false);
    expect(body.fbEventId).toMatch(/^event-/);
    expect(body.permalinkUrl).toBe(`https://facebook.com/events/${body.fbEventId}`);
    expect(body.isMock).toBe(true);
    fbEventId = body.fbEventId;
  });

  // 6. Idempotent re-publish — stejný fb_event_id
  await test.step('6. Re-publish → alreadyPublished=true, stejný fb_event_id', async () => {
    const r = await request.post(`/api/admin/events/${eventId}/publish-facebook`, {
      headers: authHeaders,
      data: { pageId },
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      alreadyPublished: boolean;
      fbEventId: string;
    };
    expect(body.alreadyPublished).toBe(true);
    expect(body.fbEventId).toBe(fbEventId);
  });

  // 7. Publish history přes GET
  await test.step('7. GET publish history → 1 záznam', async () => {
    const r = await request.get(`/api/admin/events/${eventId}/publish-facebook`, {
      headers: authHeaders,
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      publishes: Array<{ fbEventId: string; status: string; isMock: boolean }>;
    };
    expect(body.publishes.length).toBeGreaterThanOrEqual(1);
    const ours = body.publishes.find((p) => p.fbEventId === fbEventId)!;
    expect(ours.status).toBe('published');
    expect(ours.isMock).toBe(true);
  });

  // 8. Disconnect page → soft delete
  await test.step('8. Disconnect → page disappears z list', async () => {
    const r = await request.post(
      `/api/admin/facebook/pages/${pageId}/disconnect`,
      { headers: authHeaders },
    );
    expect(r.status()).toBe(200);

    const listR = await request.get('/api/admin/facebook/pages', {
      headers: authHeaders,
    });
    const body = (await listR.json()) as { pages: Array<{ id: string }> };
    expect(body.pages.find((p) => p.id === pageId)).toBeUndefined();
  });
});

test('Facebook: bez napojené page → publish vrátí PAGE_NOT_CONNECTED', async ({
  context,
  request,
}) => {
  await presetCookieConsent(context);
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const authHeaders = {
    Authorization: `Bearer ${promoterToken}`,
    'Content-Type': 'application/json',
  };

  // Cleanup — disconnect všech existujících pages
  const initialList = await request.get('/api/admin/facebook/pages', {
    headers: authHeaders,
  });
  const { pages } = (await initialList.json()) as { pages: Array<{ id: string }> };
  for (const p of pages) {
    await request.post(`/api/admin/facebook/pages/${p.id}/disconnect`, {
      headers: authHeaders,
    });
  }

  // Najdi event
  const eventsR = await request.get('/api/admin/events', { headers: authHeaders });
  const evBody = (await eventsR.json()) as
    | Array<{ id: string }>
    | { events?: Array<{ id: string }> };
  const events = Array.isArray(evBody) ? evBody : (evBody.events ?? []);
  const eventId = events[0].id;

  // Pokus o publish s fake page UUID → 404 PAGE_NOT_CONNECTED
  const r = await request.post(`/api/admin/events/${eventId}/publish-facebook`, {
    headers: authHeaders,
    data: { pageId: '00000000-0000-0000-0000-000000000000' },
  });
  expect(r.status()).toBe(404);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('PAGE_NOT_CONNECTED');
});
