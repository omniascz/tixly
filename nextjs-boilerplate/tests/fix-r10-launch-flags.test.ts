/**
 * Kolo 10 / krok 3 — nedokončené cesty jsou pro první ostrý provoz nedostupné (výchozí stav přepínačů = vypnuto).
 * Volá route handlery přímo (jako přímé API volání, bez UI). Každá kontrola leží před prací s DB.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const INTERNAL = 'r10-internal-token-0123456789abcdef';
const CRON = 'r10-cron-secret-0123456789abcdef';
const UUID = '00000000-0000-4000-8000-000000000001';
const FLAGS = ['NEXT_PUBLIC_FEATURE_INSTALLMENTS', 'NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS', 'NEXT_PUBLIC_FEATURE_BENEFIT_CARDS'];

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;
const req = (url: string, init: RequestInit = {}) => new NextRequest(`http://localhost${url}`, init as ConstructorParameters<typeof NextRequest>[1]);
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  req(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: p });

async function status(mod: Promise<Record<string, unknown>>, method: string, r: NextRequest, ctx?: unknown) {
  const h = (await mod)[method] as Handler;
  const res = await h(r, ctx);
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> | null };
}

const checkoutBody = (extra: Record<string, unknown>) => ({
  eventId: UUID, ticketTypeId: UUID, quantity: 1, buyerEmail: 'kupec@example.invalid', buyerName: 'Kupec', ...extra,
});

beforeAll(() => {
  process.env.INTERNAL_SERVICE_TOKEN = INTERNAL;
  process.env.CRON_SECRET = CRON;
});
afterEach(() => { for (const f of FLAGS) delete process.env[f]; });

describe('přepínače — výchozí stav vypnuto', () => {
  it('launchFeatureEnabled: bez proměnné false, jen "1" zapíná', async () => {
    const { launchFeatureEnabled } = await import('@/lib/features/launch-flags');
    for (const f of FLAGS) delete process.env[f];
    expect(launchFeatureEnabled('installments')).toBe(false);
    expect(launchFeatureEnabled('subscriptions')).toBe(false);
    expect(launchFeatureEnabled('benefitCards')).toBe(false);
    process.env.NEXT_PUBLIC_FEATURE_INSTALLMENTS = 'true';
    expect(launchFeatureEnabled('installments')).toBe(false);
    process.env.NEXT_PUBLIC_FEATURE_INSTALLMENTS = '1';
    expect(launchFeatureEnabled('installments')).toBe(true);
  });
});

describe('splátky — vypnuto v checkoutu, API i cronu', () => {
  it('checkout s paymentPlanId → 422 FEATURE_DISABLED', async () => {
    const r = await status(import('@/app/api/checkout/route'), 'POST', post('/api/checkout', checkoutBody({ paymentPlanId: UUID })));
    expect(r).toMatchObject({ status: 422, body: { error: 'FEATURE_DISABLED', feature: 'installments' } });
  });
  it.each(['twisto', 'skippay'])('checkout s BNPL %s → 422 FEATURE_DISABLED', async (m) => {
    const r = await status(import('@/app/api/checkout/route'), 'POST', post('/api/checkout', checkoutBody({ paymentMethod: m })));
    expect(r).toMatchObject({ status: 422, body: { error: 'FEATURE_DISABLED', feature: 'installments' } });
  });
  it('POST /api/buyer/orders/:id/payment-plan → 404', async () => {
    const r = await status(import('@/app/api/buyer/orders/[orderId]/payment-plan/route'), 'POST',
      post(`/api/buyer/orders/${UUID}/payment-plan`, { planId: UUID }), params({ orderId: UUID }));
    expect(r.status).toBe(404);
  });
  it('GET /api/events/:id/payment-plans → 404', async () => {
    const r = await status(import('@/app/api/events/[id]/payment-plans/route'), 'GET', req(`/api/events/${UUID}/payment-plans`), params({ id: UUID }));
    expect(r.status).toBe(404);
  });
  it('GET i POST /api/admin/events/:id/payment-plans → 404', async () => {
    const mod = import('@/app/api/admin/events/[id]/payment-plans/route');
    expect((await status(mod, 'GET', req(`/api/admin/events/${UUID}/payment-plans`), params({ id: UUID }))).status).toBe(404);
    expect((await status(mod, 'POST', post(`/api/admin/events/${UUID}/payment-plans`, { name: 'x', installmentsCount: 3 }), params({ id: UUID }))).status).toBe(404);
  });
  it('cron charge-installments (platný interní token) → 404', async () => {
    const r = await status(import('@/app/api/internal/cron/charge-installments/route'), 'POST',
      post('/api/internal/cron/charge-installments', {}, { 'x-internal-token': INTERNAL }));
    expect(r.status).toBe(404);
  });
  it('mock-bnpl confirm → 404', async () => {
    const r = await status(import('@/app/api/mock-bnpl/[provider]/[paymentId]/confirm/route'), 'POST',
      post(`/api/mock-bnpl/twisto/${UUID}/confirm`, { installments: 3 }), params({ provider: 'twisto', paymentId: UUID }));
    expect(r.status).toBe(404);
  });
});

describe('předplatné — aktivace i checkout vypnuté', () => {
  it('checkout s useSubscription → 422 FEATURE_DISABLED', async () => {
    const r = await status(import('@/app/api/checkout/route'), 'POST', post('/api/checkout', checkoutBody({ useSubscription: true })));
    expect(r).toMatchObject({ status: 422, body: { error: 'FEATURE_DISABLED', feature: 'subscriptions' } });
  });
  it('GET i POST /api/buyer/subscriptions → 404', async () => {
    const mod = import('@/app/api/buyer/subscriptions/route');
    expect((await status(mod, 'GET', req('/api/buyer/subscriptions'))).status).toBe(404);
    expect((await status(mod, 'POST', post('/api/buyer/subscriptions', { planId: UUID }))).status).toBe(404);
  });
  it('POST /api/subscriptions/subscribe → 404', async () => {
    const r = await status(import('@/app/api/subscriptions/subscribe/route'), 'POST', post('/api/subscriptions/subscribe', { planId: UUID, email: 'a@example.invalid' }));
    expect(r.status).toBe(404);
  });
  it('POST /api/subscriptions/checkout (abonentka) → 404', async () => {
    const r = await status(import('@/app/api/subscriptions/checkout/route'), 'POST', post('/api/subscriptions/checkout', { packageId: UUID, email: 'a@example.invalid' }));
    expect(r.status).toBe(404);
  });
  it('POST /api/subscriptions/holders/:id/confirm → 404', async () => {
    const r = await status(import('@/app/api/subscriptions/holders/[paymentId]/confirm/route'), 'POST',
      post(`/api/subscriptions/holders/${UUID}/confirm`, {}), params({ paymentId: UUID }));
    expect(r.status).toBe(404);
  });
  it('GET /api/subscriptions/plans a /api/subscriptions/packages/:slug → 404', async () => {
    expect((await status(import('@/app/api/subscriptions/plans/route'), 'GET', req('/api/subscriptions/plans'))).status).toBe(404);
    expect((await status(import('@/app/api/subscriptions/packages/[slug]/route'), 'GET', req('/api/subscriptions/packages/x'), params({ slug: 'x' }))).status).toBe(404);
  });
  it('cron renew-subscriptions (platný interní token) → 404', async () => {
    const r = await status(import('@/app/api/internal/cron/renew-subscriptions/route'), 'POST',
      post('/api/internal/cron/renew-subscriptions', {}, { 'x-internal-token': INTERNAL }));
    expect(r.status).toBe(404);
  });
});

describe('benefitní karty — vypnuté', () => {
  it.each(['pluxee', 'sodexo', 'benefit_plus', 'edenred', 'gallery_beta', 'multisport'])('checkout s %s → 422 FEATURE_DISABLED', async (m) => {
    const r = await status(import('@/app/api/checkout/route'), 'POST', post('/api/checkout', checkoutBody({ paymentMethod: m })));
    expect(r).toMatchObject({ status: 422, body: { error: 'FEATURE_DISABLED', feature: 'benefitCards' } });
  });
  it('callbacky benefit a pluxee → 404', async () => {
    expect((await status(import('@/app/api/payments/benefit/callback/route'), 'POST', post('/api/payments/benefit/callback', { paymentId: UUID }))).status).toBe(404);
    expect((await status(import('@/app/api/payments/benefit/pluxee/callback/route'), 'POST', post('/api/payments/benefit/pluxee/callback', { paymentId: UUID }))).status).toBe(404);
  });
});

describe('crony', () => {
  const vercel = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf8')) as { crons: Array<{ path: string }> };
  const paths = vercel.crons.map((c) => c.path);
  it('payouts-execute, charge-installments, renew-subscriptions nejsou naplánované ve vercel.json', () => {
    expect(paths.filter((p) => /payouts-execute|charge-installments|renew-subscriptions/.test(p))).toEqual([]);
  });
  it('dispatcher payouts-execute nezná (422)', async () => {
    const r = await status(import('@/app/api/cron/dispatch/route'), 'GET',
      req('/api/cron/dispatch?job=payouts-execute', { headers: { authorization: `Bearer ${CRON}` } }));
    expect(r.status).toBe(422);
  });
  it('lastminute je naplánovaný a GET bez tajemství → 401', async () => {
    expect(paths).toContain('/api/admin/lastminute/check');
    const r = await status(import('@/app/api/admin/lastminute/check/route'), 'GET', req('/api/admin/lastminute/check'));
    expect(r.status).toBe(401);
  });
  it('lastminute GET se špatným tajemstvím → 401', async () => {
    const r = await status(import('@/app/api/admin/lastminute/check/route'), 'GET',
      req('/api/admin/lastminute/check', { headers: { authorization: 'Bearer spatne' } }));
    expect(r.status).toBe(401);
  });
});
