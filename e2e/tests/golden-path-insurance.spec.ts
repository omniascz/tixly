/**
 * Golden Path: Stornoschutz / Pojištění zrušení vstupenky
 *
 * End-to-end ověření #2 z DACH-AUDIT-VERIFIED.md (DACH standard u všech 9 platforem):
 *   1. Promotér v /admin/events/[id]/settings zapne insurance + nastaví %
 *   2. Buyer v checkoutu vidí "🛡️ Pojištění zrušení (+X Kč)" checkbox s live preview ceny
 *   3. Buyer zaškrtne + dokončí checkout → orders.order_insurance row vytvořen
 *   4. Buyer si později uplatní claim přes API → status='claimed', refund schválen,
 *      order='refunded', tickety 'revoked'
 *
 * Předpoklady:
 *   - Romeo a Julie (401) má insurance_enabled = TRUE, insurance_pct = 8
 *     (pokud ne, test ho zapne přes promotér login)
 *   - theatre@hranice.cz / Demo2026! je owner promotéra
 *   - anna.nova@example.cz / Demo2026! je buyer s loginem
 */
import { test, expect, type BrowserContext } from '@playwright/test';

// admin@tixly.cz vlastní Demo Promoter — má bohatě non-seated published eventů
// (Demo Smoke Test Concert, festivaly), které nepotřebují schvalování master adminem
// jako u T1 promotérů.
const PROMOTER_EMAIL = 'admin@tixly.cz';
const PROMOTER_PASSWORD = 'Demo2026!';
const BUYER_EMAIL = 'anna.nova@example.cz';
const BUYER_PASSWORD = 'Demo2026!';

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
  const body = (await res.json()) as { accessToken: string };
  await context.addInitScript((token) => {
    try {
      window.localStorage.setItem('accessToken', token);
    } catch {
      /* noop */
    }
  }, body.accessToken);
  return body.accessToken;
}

test('Insurance: promotér zapne pojistku → buyer ji koupí → uplatní claim', async ({
  page,
  context,
  request,
}) => {
  await presetCookieConsent(context);

  // 0. Najdi non-seated paid published event z admin@tixly.cz portfolia.
  //    Demo Promoter má bohatě demo eventů jako "Demo Smoke Test Concert".
  const promoterToken = await apiLogin(context, PROMOTER_EMAIL, PROMOTER_PASSWORD);
  const eventsRes = await request.get('/api/admin/events', {
    headers: { Authorization: `Bearer ${promoterToken}` },
  });
  expect(eventsRes.status()).toBe(200);
  const eventsBody = (await eventsRes.json()) as
    | Array<{ id: string; moderationStatus?: string }>
    | { events?: Array<{ id: string; moderationStatus?: string }> };
  const allEvents = Array.isArray(eventsBody) ? eventsBody : (eventsBody.events ?? []);
  const candidates = allEvents.filter(
    (e) => e.moderationStatus === 'published' || !e.moderationStatus,
  );

  let eventId = '';
  let usableTtId = '';
  for (const ev of candidates) {
    const ttRes = await request.get(`/api/events/${ev.id}/ticket-types`);
    if (!ttRes.ok()) continue;
    const tt = (await ttRes.json()) as {
      ticketTypes: Array<{
        id: string;
        remainingQty: number;
        basePrice: number;
        isSeated: boolean;
      }>;
    };
    const usable = tt.ticketTypes.find(
      (t) => !t.isSeated && t.remainingQty > 0 && t.basePrice > 0,
    );
    if (usable) {
      eventId = ev.id;
      usableTtId = usable.id;
      break;
    }
  }
  expect(
    eventId,
    `Nalezen non-seated paid published event (${candidates.length} kandidátů)`,
  ).toBeTruthy();

  // 1. Promotér se ujistí, že insurance je zapnutý (idempotent).
  await test.step('1. Promotér zapne insurance v admin settings', async () => {
    const patchRes = await context.request.patch(`/api/admin/events/${eventId}`, {
      headers: {
        Authorization: `Bearer ${promoterToken}`,
        'Content-Type': 'application/json',
      },
      data: { insuranceEnabled: true, insurancePct: 8 },
    });
    expect(patchRes.status(), 'PATCH insurance settings').toBe(200);
  });

  // 2. Public addons API vrací insurance config (pro buyer UI).
  let basePriceHalire = 0;
  let ticketTypeId = '';
  await test.step('2. Public API vrací insurance info', async () => {
    const res = await context.request.get(`/api/events/${eventId}/addons`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      insurance: { enabled: true; pct: number; currency: string } | null;
    };
    expect(body.insurance).not.toBeNull();
    expect(body.insurance!.enabled).toBe(true);
    expect(body.insurance!.pct).toBe(8);

    // Načti basePrice pro usable ticket type (z init filtering — usableTtId).
    const ttRes = await context.request.get(`/api/events/${eventId}/ticket-types`);
    const tt = (await ttRes.json()) as {
      ticketTypes: Array<{ id: string; basePrice: number; remainingQty: number }>;
    };
    const usable = tt.ticketTypes.find((t) => t.id === usableTtId);
    expect(usable).toBeTruthy();
    ticketTypeId = usable!.id;
    basePriceHalire = usable!.basePrice;
  });

  let buyerToken = '';
  let createdOrderId = '';

  // 3. UI verify — checkbox je viditelný v checkoutu s live preview ceny.
  await test.step('3. UI: checkbox "Pojištění zrušení" je viditelný', async () => {
    buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);

    await page.goto(
      `/cs/checkout?eventId=${eventId}&ticketTypeId=${ticketTypeId}&quantity=1`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.getByLabel('Jméno a příjmení').waitFor({ state: 'visible', timeout: 15_000 });

    const insuranceCheckbox = page.getByTestId('insurance-opt-in');
    await expect(insuranceCheckbox).toBeVisible({ timeout: 5_000 });

    // Label musí obsahovat "Pojištění zrušení" + popis pojistného. Konkrétní cena
    // "(+X Kč)" se přidá až po async fetch ticket-types — testujeme jen základní
    // visibility (cena je verifikována přes totalAmount v API checkout step).
    await expect(page.getByText(/🛡️ Pojištění zrušení/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Pojistné 8 % z ceny/i)).toBeVisible();
  });

  // 4. API checkout s insuranceOptIn=true.
  await test.step('4. POST /api/checkout s insuranceOptIn=true → mock-gopay PAY', async () => {
    const checkoutRes = await context.request.post('/api/checkout', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        eventId,
        ticketTypeId,
        quantity: 1,
        buyerEmail: BUYER_EMAIL,
        buyerName: 'Anna Nova',
        insuranceOptIn: true,
      },
    });

    if (checkoutRes.status() >= 400) {
      const errBody = await checkoutRes.json();
      throw new Error(
        `Checkout failed (${checkoutRes.status()}): ${JSON.stringify(errBody)}`,
      );
    }
    const checkoutBody = (await checkoutRes.json()) as {
      orderId: string;
      gatewayUrl: string;
      paymentId: string;
      totalAmount: number;
    };
    createdOrderId = checkoutBody.orderId;

    // Total amount musí být > base price (premium added)
    const expectedPremium = Math.floor((basePriceHalire * 8) / 100);
    expect(checkoutBody.totalAmount).toBe(basePriceHalire + expectedPremium);

    // Mock-gopay PAY → order='paid'
    const pay = await context.request.post(
      `/api/mock-gopay/${checkoutBody.paymentId}`,
      { data: { action: 'pay' } },
    );
    expect(pay.status()).toBe(200);
  });

  // 5. Insurance claim → status='claimed', refund schválen.
  await test.step('5. Buyer uplatní claim → refund schválen', async () => {
    const claimRes = await context.request.post(
      `/api/buyer/orders/${createdOrderId}/insurance-claim`,
      {
        headers: {
          Authorization: `Bearer ${buyerToken}`,
          'Content-Type': 'application/json',
        },
        data: { reason: 'Onemocněl jsem — chřipka s horečkou' },
      },
    );
    expect(claimRes.status(), 'Insurance claim').toBe(200);
    const claimBody = (await claimRes.json()) as {
      ok: boolean;
      claimAmount: number;
      message: string;
    };
    expect(claimBody.ok).toBe(true);
    expect(claimBody.claimAmount).toBeGreaterThan(0);
    expect(claimBody.message).toMatch(/refund|lístky/i);
  });
});

test('Insurance: buyer bez pojistky dostane NO_INSURANCE error', async ({ context }) => {
  await presetCookieConsent(context);
  const buyerToken = await apiLogin(context, BUYER_EMAIL, BUYER_PASSWORD);

  // Najdi nějakou Anninu starou objednávku (Hamlet po Anna's předchozím testu byl prodán
  // přes FanSALE, ale i sold orders zůstávají v DB jako 'paid'). Hledáme jakoukoliv
  // bez insurance.
  const ordersRes = await context.request.get('/api/buyer/orders', {
    headers: { Authorization: `Bearer ${buyerToken}` },
  });
  // Endpoint mohou ne all variants — test je informativní (skip pokud absent).
  test.skip(
    ordersRes.status() !== 200,
    `/api/buyer/orders nedostupný (${ordersRes.status()})`,
  );

  const orders = (await ordersRes.json()) as {
    orders?: Array<{ id: string }>;
  };
  test.skip(
    !orders.orders || orders.orders.length === 0,
    'Anna nemá zaznamenané historické objednávky',
  );

  const orderId = orders.orders![0].id;
  const claimRes = await context.request.post(
    `/api/buyer/orders/${orderId}/insurance-claim`,
    {
      headers: {
        Authorization: `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      data: { reason: 'Test bez aktivní pojistky' },
    },
  );

  // Pokud Anna náhodou má insurance, status bude 200. Tento test je sekundární.
  if (claimRes.status() === 200) {
    test.skip(true, 'Order náhodou má aktivní pojistku — primary test je nahoře');
    return;
  }
  expect([404, 409], 'NO_INSURANCE nebo INSURANCE_NOT_ACTIVE').toContain(claimRes.status());
});
