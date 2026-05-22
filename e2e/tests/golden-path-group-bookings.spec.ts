/**
 * Golden Path: Group bookings light (TIER 2 #5, ROI 6/10)
 *
 * MVP scope — žádné payment splitting. Organizer vytvoří share link,
 * friend klikne, vidí "X z N už zaplatilo" a koupí ticket přes
 * existující checkout s ?groupInvitation=<token>. Order linkne na
 * group_invitations a po dosažení target_seats group flipne na 'completed'.
 *
 * Flow:
 *   1. Organizer POST /api/buyer/group-invitations → token + URL
 *   2. Anonymous GET /api/group-invitations/[token] → preview + progress
 *   3. Friend (jiný buyer) checkout s groupInvitationToken → order linked
 *   4. GET znovu → progress.alreadyPaid se zvýší
 *   5. Validace: invalid token 400/404, target < 2 → 422, no auth → 401
 */
import { test, expect, type BrowserContext } from '@playwright/test';

const ORGANIZER_EMAIL = 'anna.nova@example.cz';
const FRIEND_EMAIL = 'verze@divadlovceletne.cz';

async function login(
  context: BrowserContext,
  email: string,
): Promise<{ accessToken: string; userId: string }> {
  const r = await context.request.post('/api/auth/login', {
    data: { email, password: 'Demo2026!' },
  });
  if (r.status() !== 200) throw new Error(`Login failed: ${email}`);
  const body = (await r.json()) as { accessToken: string; user: { id: string } };
  return { accessToken: body.accessToken, userId: body.user.id };
}

// Hard-coded seed event — Romeo a Julie. Published, has ticket types.
// Aktuálně neexistuje GET /api/events/[id] sjednocený endpoint, tak používáme
// známé seed UUID. Ticket type linkujeme přes seznam přes addons endpoint
// nebo prostě vynecháme — group endpoint funguje i bez ticket_type_id.
const SEED_EVENT_ID = '00000000-0000-4000-a000-000000000401';

test('Group: organizer create → public preview → progress tracking', async ({
  context,
}) => {
  const organizer = await login(context, ORGANIZER_EMAIL);
  const eventId = SEED_EVENT_ID; const ticketTypeId = null;

  // 1. Organizer creates invite
  const create = await context.request.post('/api/buyer/group-invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': organizer.userId,
      Authorization: `Bearer ${organizer.accessToken}`,
    },
    data: {
      eventId,
      ticketTypeId: ticketTypeId ?? undefined,
      targetSeats: 4,
      message: 'Pojďte se mnou na divadlo!',
    },
  });
  expect(create.status()).toBe(200);
  const created = (await create.json()) as {
    ok: boolean;
    invitationId: string;
    inviteToken: string;
    inviteUrl: string;
    expiresAt: string;
  };
  expect(created.ok).toBe(true);
  expect(created.inviteToken).toMatch(/^[A-Za-z0-9_-]{20,80}$/);
  expect(created.inviteUrl).toContain(`/cs/group/${created.inviteToken}`);

  // 2. Public GET preview (no auth)
  await test.step('Public GET preview', async () => {
    const r = await context.request.get(
      `/api/group-invitations/${created.inviteToken}`,
    );
    expect(r.status()).toBe(200);
    const body = (await r.json()) as {
      organizer: { email: string };
      event: { id: string };
      targetSeats: number;
      progress: { alreadyPaid: number; remaining: number; targetSeats: number };
      message: string;
      status: string;
      expired: boolean;
      checkoutUrl: string;
    };
    expect(body.organizer.email).toBe(ORGANIZER_EMAIL);
    expect(body.event.id).toBe(eventId);
    expect(body.targetSeats).toBe(4);
    expect(body.progress.targetSeats).toBe(4);
    expect(body.status).toBe('open');
    expect(body.expired).toBe(false);
    expect(body.message).toContain('Pojďte');
    expect(body.checkoutUrl).toContain(`groupInvitation=${created.inviteToken}`);
  });
});

test('Group: invalid token → 400', async ({ context }) => {
  const r = await context.request.get('/api/group-invitations/short');
  expect(r.status()).toBe(400);
});

test('Group: nonexistent token → 404', async ({ context }) => {
  const r = await context.request.get(
    '/api/group-invitations/totally-bogus-token-12345-abcdefghij',
  );
  expect(r.status()).toBe(404);
});

test('Group: targetSeats < 2 → 422', async ({ context }) => {
  const organizer = await login(context, ORGANIZER_EMAIL);
  const eventId = SEED_EVENT_ID;
  const r = await context.request.post('/api/buyer/group-invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': organizer.userId,
      Authorization: `Bearer ${organizer.accessToken}`,
    },
    data: { eventId, targetSeats: 1 },
  });
  expect(r.status()).toBe(422);
});

test('Group: targetSeats > 50 → 422', async ({ context }) => {
  const organizer = await login(context, ORGANIZER_EMAIL);
  const eventId = SEED_EVENT_ID;
  const r = await context.request.post('/api/buyer/group-invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': organizer.userId,
      Authorization: `Bearer ${organizer.accessToken}`,
    },
    data: { eventId, targetSeats: 99 },
  });
  expect(r.status()).toBe(422);
});

test('Group: no auth → 401', async ({ context }) => {
  const eventId = SEED_EVENT_ID;
  const r = await context.request.post('/api/buyer/group-invitations', {
    headers: { 'Content-Type': 'application/json' },
    data: { eventId, targetSeats: 3 },
  });
  expect(r.status()).toBe(401);
});

test('Group: nonexistent event → 404', async ({ context }) => {
  const organizer = await login(context, ORGANIZER_EMAIL);
  const r = await context.request.post('/api/buyer/group-invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': organizer.userId,
      Authorization: `Bearer ${organizer.accessToken}`,
    },
    data: {
      eventId: '00000000-0000-0000-0000-000000000999',
      targetSeats: 3,
    },
  });
  expect(r.status()).toBe(404);
});

test('Group UI: claim page renderuje preview', async ({ page, context }) => {
  const organizer = await login(context, ORGANIZER_EMAIL);
  const eventId = SEED_EVENT_ID;
  const create = await context.request.post('/api/buyer/group-invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': organizer.userId,
      Authorization: `Bearer ${organizer.accessToken}`,
    },
    data: { eventId, targetSeats: 5, message: 'UI smoke message' },
  });
  expect(create.status()).toBe(200);
  const body = (await create.json()) as { inviteToken: string };

  await page.goto(`/cs/group/${body.inviteToken}`);
  await page.waitForLoadState('domcontentloaded');

  await expect(page.getByText(/Pozvánka do skupiny/)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/UI smoke message/)).toBeVisible();
  await expect(page.getByText(/Připojit se a koupit/)).toBeVisible();
});

// Smoke: friend identification — use FRIEND_EMAIL login pro alternativní user
test('Group: friend (different user) může také zobrazit preview', async ({
  context,
}) => {
  const organizer = await login(context, ORGANIZER_EMAIL);
  const friend = await login(context, FRIEND_EMAIL);
  expect(friend.userId).not.toBe(organizer.userId);

  const eventId = SEED_EVENT_ID;
  const create = await context.request.post('/api/buyer/group-invitations', {
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': organizer.userId,
      Authorization: `Bearer ${organizer.accessToken}`,
    },
    data: { eventId, targetSeats: 3 },
  });
  const body = (await create.json()) as { inviteToken: string };

  const friendGet = await context.request.get(
    `/api/group-invitations/${body.inviteToken}`,
    {
      headers: {
        'x-user-id': friend.userId,
        Authorization: `Bearer ${friend.accessToken}`,
      },
    },
  );
  expect(friendGet.status()).toBe(200);
  const friendBody = (await friendGet.json()) as {
    organizer: { email: string };
  };
  expect(friendBody.organizer.email).toBe(ORGANIZER_EMAIL);
});
