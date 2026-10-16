// @vitest-environment node
/**
 * Kolo 23 / krok 1.5 — GET /api/events/[id]/ticket-types hlásí `weroAvailable` podle mock-guardu.
 *
 * Wero má jen mock bránu; v produkci (NODE_ENV=production bez ALLOW_MOCK_PAYMENTS=1) ji provider odmítne. Pokladna
 * proto volbu Wero zobrazí jen podle `weroAvailable` z této odpovědi (stejně jako krypto podle `legacyPaymentGateways`).
 *
 * Skutečný route handler proti lokální DB z migrací (FIX_E2E=1) nebo Neon klonu; handler běží pod tixly_app (RLS).
 * DB se nemockuje, mock-guard se nemockuje — mění se jen proměnné prostředí, které mock-guard čte.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { createLiveClone, hasLiveDb, makeSeed, type LiveClone } from './helpers/live-fixture';

type Env = Record<string, string | undefined>;

describe.skipIf(!hasLiveDb)('ticket-types — weroAvailable (live, tixly_app)', () => {
  let clone: LiveClone | undefined;
  let eventId = '';
  let GET: (req: NextRequest, props: { params: Promise<{ id: string }> }) => Promise<Response>;
  const env = process.env as Env;
  const saved = { NODE_ENV: env.NODE_ENV, ALLOW_MOCK_PAYMENTS: env.ALLOW_MOCK_PAYMENTS };

  beforeAll(async () => {
    clone = await createLiveClone('r23-wero-ticket-types');
    const chain = await makeSeed(clone.pool).chain();
    eventId = chain.eventId;
    ({ GET } = await import('@/app/api/events/[id]/ticket-types/route'));
  });

  afterAll(async () => {
    env.NODE_ENV = saved.NODE_ENV;
    if (saved.ALLOW_MOCK_PAYMENTS === undefined) delete env.ALLOW_MOCK_PAYMENTS;
    else env.ALLOW_MOCK_PAYMENTS = saved.ALLOW_MOCK_PAYMENTS;
    await clone?.cleanup();
  });

  async function fetchWith(nodeEnv: string, allow: string | undefined): Promise<{ status: number; json: Record<string, unknown> }> {
    env.NODE_ENV = nodeEnv;
    if (allow === undefined) delete env.ALLOW_MOCK_PAYMENTS;
    else env.ALLOW_MOCK_PAYMENTS = allow;
    const req = new Request(`http://localhost:3000/api/events/${eventId}/ticket-types`);
    const res = await GET(req as unknown as NextRequest, { params: Promise.resolve({ id: eventId }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it.each([
    ['production', undefined, false],
    ['production', '0', false],
    ['production', 'true', false],
    ['production', '1', true],
    ['development', undefined, true],
    ['test', undefined, true],
  ] as const)('NODE_ENV=%s, ALLOW_MOCK_PAYMENTS=%s → weroAvailable=%s', async (nodeEnv, allow, expected) => {
    const { status, json } = await fetchWith(nodeEnv, allow);
    expect(status).toBe(200);
    // pojistka proti průchodu naprázdno: odpověď je skutečný seznam typů vstupenek seedované akce
    expect((json.ticketTypes as unknown[]).length).toBe(1);
    expect(json).toHaveProperty('weroAvailable');
    expect(json.weroAvailable).toBe(expected);
  });
});
