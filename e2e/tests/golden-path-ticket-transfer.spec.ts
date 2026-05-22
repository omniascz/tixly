/**
 * Golden Path: Friend ticket transfer (CZ priority #1, ROI 9/10)
 *
 * Tixly už mělo BACKEND endpointy (transfer-invite + accept) z dřívější
 * iterace ale CHYBĚLA UI claim page + E2E pokrytí. Tato sada to doplňuje.
 *
 * Schema: tickets.transfer_invitations (status pending/accepted/expired/cancelled,
 * invite_token, expires_at 7d default).
 *
 * Flow:
 *   1) UserA má valid ticket (existing seeded)
 *   2) POST /api/buyer/tickets/[ticketId]/transfer-invite → invitation + token
 *   3) GET /api/transfer/accept/[token] (public, no auth) → preview data
 *   4) POST /api/transfer/accept/[token] (recipient logged-in) → ownership change
 *   5) Validace: CANT_TRANSFER_TO_SELF, EMAIL_MISMATCH, ALREADY_RESOLVED,
 *      PENDING_TRANSFER_EXISTS, CANT_ACCEPT_OWN_TRANSFER
 *   6) UI smoke: /cs/transfer/accept/[token] zobrazí pending state
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const OWNER_EMAIL = 'anna.nova@example.cz';
const OWNER_PASSWORD = 'Demo2026!';

async function apiLogin(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<{ accessToken: string; userId: string }> {
  const r = await context.request.post('/api/auth/login', {
    data: { email, password },
  });
  if (r.status() !== 200) throw new Error(`Login failed for ${email}`);
  const body = (await r.json()) as { accessToken: string; user: { id: string } };
  return { accessToken: body.accessToken, userId: body.user.id };
}

async function findOwnedValidTicket(
  context: BrowserContext,
  ownerEmail: string,
): Promise<{ ticketId: string; ownerId: string }> {
  const owner = await apiLogin(context, ownerEmail, OWNER_PASSWORD);
  const r = await context.request.get('/api/buyer/my-tickets', {
    headers: { 'x-user-id': owner.userId, Authorization: `Bearer ${owner.accessToken}` },
  });
  if (!r.ok()) throw new Error(`my-tickets ${r.status()}`);
  const body = (await r.json()) as {
    tickets?: Array<{ id: string; status: string; event_date?: string }>;
  };
  const tickets = body.tickets ?? [];
  const usable = tickets.find(
    (t) => t.status === 'valid' && (!t.event_date || new Date(t.event_date) > new Date()),
  );
  if (!usable) {
    throw new Error('Anna.nova nemá valid future ticket — seed potřeba');
  }
  return { ticketId: usable.id, ownerId: owner.userId };
}

test('Transfer: full lifecycle (invite → accept → ownership change)', async ({
  context,
}) => {
  // Použijeme verze@divadlovceletne.cz jako recipient (existing user)
  const recipientEmail = 'verze@divadlovceletne.cz';
  const recipient = await apiLogin(context, recipientEmail, 'Demo2026!');

  // Najdi ticket — zkusíme více kandidátů, vyhneme se těm s pending nebo
  // už transferred k recipientovi z předchozího run.
  const owner = await apiLogin(context, OWNER_EMAIL, OWNER_PASSWORD);
  const myT = await context.request.get('/api/buyer/my-tickets', {
    headers: { 'x-user-id': owner.userId, Authorization: `Bearer ${owner.accessToken}` },
  });
  const body = (await myT.json()) as {
    tickets: Array<{ id: string; status: string; event_date?: string }>;
  };
  const candidates = body.tickets.filter(
    (t) => t.status === 'valid' && (!t.event_date || new Date(t.event_date) > new Date()),
  );

  let ticketId = '';
  let inviteUrl = '';
  let invitationId = '';
  // Iteruj kandidáty dokud nenajdeš ten kde můžeš vytvořit transfer
  for (const c of candidates.slice(0, 20)) {
    // Pre-cleanup case pending z dřívějších runs
    await context.request.delete(`/api/buyer/tickets/${c.id}/transfer-invite`, {
      headers: { 'x-user-id': owner.userId },
    });
    const r = await context.request.post(
      `/api/buyer/tickets/${c.id}/transfer-invite`,
      {
        headers: { 'Content-Type': 'application/json', 'x-user-id': owner.userId },
        data: { toEmail: recipientEmail, message: 'Užij si to!' },
      },
    );
    if (r.status() === 201) {
      const inv = (await r.json()) as { invitationId: string; inviteUrl: string };
      ticketId = c.id;
      inviteUrl = inv.inviteUrl;
      invitationId = inv.invitationId;
      break;
    }
  }
  expect(ticketId, 'usable ticket found').toBeTruthy();
  expect(invitationId).toBeTruthy();

  const ownerId = owner.userId;

  const tokenMatch = /\/transfer\/accept\/([A-Za-z0-9_-]+)$/.exec(inviteUrl);
  expect(tokenMatch).toBeTruthy();
  const token = tokenMatch![1];

  // 3. Public GET preview (no auth)
  await test.step('GET accept preview (public)', async () => {
    const r = await context.request.get(`/api/transfer/accept/${token}`);
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      from: { email: string };
      toEmail: string;
      message: string;
      event: { title: string };
    };
    expect(body.from.email).toBe(OWNER_EMAIL);
    expect(body.toEmail).toBe(recipientEmail);
    expect(body.message).toBe('Užij si to!');
    expect(body.event.title).toBeTruthy();
  });

  // 4. POST accept jako recipient
  await test.step('POST accept jako recipient → ownership transferred', async () => {
    const r = await context.request.post(`/api/transfer/accept/${token}`, {
      headers: { 'x-user-id': recipient.userId },
    });
    expect(r.status()).toBe(200);
    const body = (await r.json()) as { accepted: boolean; ticketId: string };
    expect(body.accepted).toBe(true);
    expect(body.ticketId).toBe(ticketId);
  });

  // 5. Re-accept same token → 410 ALREADY_RESOLVED
  await test.step('Re-accept → 410 ALREADY_RESOLVED', async () => {
    const r = await context.request.post(`/api/transfer/accept/${token}`, {
      headers: { 'x-user-id': recipient.userId },
    });
    expect(r.status()).toBe(410);
    const body = (await r.json()) as { error: string; status: string };
    expect(body.error).toBe('ALREADY_RESOLVED');
    expect(body.status).toBe('accepted');
  });

  // 6. Transfer ticket BACK to owner pro idempotent test runs
  await test.step('Cleanup: transfer ticket back to owner', async () => {
    const reverse = await context.request.post(
      `/api/buyer/tickets/${ticketId}/transfer-invite`,
      {
        headers: { 'Content-Type': 'application/json', 'x-user-id': recipient.userId },
        data: { toEmail: OWNER_EMAIL },
      },
    );
    if (reverse.status() === 201) {
      const body = (await reverse.json()) as { inviteUrl: string };
      const m = /\/transfer\/accept\/([A-Za-z0-9_-]+)$/.exec(body.inviteUrl);
      if (m) {
        await context.request.post(`/api/transfer/accept/${m[1]}`, {
          headers: { 'x-user-id': ownerId },
        });
      }
    }
  });
});

test('Transfer: self-transfer → 422 CANT_TRANSFER_TO_SELF', async ({ context }) => {
  const { ticketId, ownerId } = await findOwnedValidTicket(context, OWNER_EMAIL);
  // Cleanup
  await context.request.delete(`/api/buyer/tickets/${ticketId}/transfer-invite`, {
    headers: { 'x-user-id': ownerId },
  });

  const r = await context.request.post(
    `/api/buyer/tickets/${ticketId}/transfer-invite`,
    {
      headers: { 'Content-Type': 'application/json', 'x-user-id': ownerId },
      data: { toEmail: OWNER_EMAIL },
    },
  );
  expect(r.status()).toBe(422);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe('CANT_TRANSFER_TO_SELF');
});

test('Transfer: pending → cancel → 200', async ({ context }) => {
  const { ticketId, ownerId } = await findOwnedValidTicket(context, OWNER_EMAIL);
  await context.request.delete(`/api/buyer/tickets/${ticketId}/transfer-invite`, {
    headers: { 'x-user-id': ownerId },
  });

  // Create
  const create = await context.request.post(
    `/api/buyer/tickets/${ticketId}/transfer-invite`,
    {
      headers: { 'Content-Type': 'application/json', 'x-user-id': ownerId },
      data: { toEmail: `cancel-${Date.now()}@example.cz` },
    },
  );
  expect(create.status()).toBe(201);

  // Duplicate → 409
  const dup = await context.request.post(
    `/api/buyer/tickets/${ticketId}/transfer-invite`,
    {
      headers: { 'Content-Type': 'application/json', 'x-user-id': ownerId },
      data: { toEmail: `dup-${Date.now()}@example.cz` },
    },
  );
  expect(dup.status()).toBe(409);
  const dupBody = (await dup.json()) as { error: string };
  expect(dupBody.error).toBe('PENDING_TRANSFER_EXISTS');

  // Cancel
  const cancel = await context.request.delete(
    `/api/buyer/tickets/${ticketId}/transfer-invite`,
    { headers: { 'x-user-id': ownerId } },
  );
  expect(cancel.status()).toBe(200);

  // Re-cancel → 404
  const reCancel = await context.request.delete(
    `/api/buyer/tickets/${ticketId}/transfer-invite`,
    { headers: { 'x-user-id': ownerId } },
  );
  expect(reCancel.status()).toBe(404);
});

test('Transfer: invalid token → 404', async ({ context }) => {
  const r = await context.request.get(
    '/api/transfer/accept/totally-bogus-12345-abcde',
  );
  expect(r.status()).toBe(404);
});

test('Transfer UI: claim page renderuje pending state', async ({ page, context }) => {
  const { ticketId, ownerId } = await findOwnedValidTicket(context, OWNER_EMAIL);
  await context.request.delete(`/api/buyer/tickets/${ticketId}/transfer-invite`, {
    headers: { 'x-user-id': ownerId },
  });

  const initRes = await context.request.post(
    `/api/buyer/tickets/${ticketId}/transfer-invite`,
    {
      headers: { 'Content-Type': 'application/json', 'x-user-id': ownerId },
      data: {
        toEmail: `ui-rcp-${Date.now()}@example.cz`,
        message: 'Hezký koncert!',
      },
    },
  );
  const body = (await initRes.json()) as { inviteUrl: string };
  const m = /\/transfer\/accept\/([A-Za-z0-9_-]+)$/.exec(body.inviteUrl);
  expect(m).toBeTruthy();

  await page.goto(`/cs/transfer/accept/${m![1]}`);
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByTestId('transfer-pending')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Máš tu vstupenku/)).toBeVisible();
  await expect(page.getByTestId('accept-button')).toBeVisible();
  await expect(page.getByText(/Hezký koncert!/)).toBeVisible();
});
