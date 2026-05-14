/**
 * POST /api/payments/benefit/callback
 *
 * Universal callback handler pro benefit providery. Body:
 *   { provider, externalId, success, payload? }
 *
 * Real provider callbacks mají často vlastní auth (signature, IP whitelist).
 * Pro produkční integraci přidat per-provider verifikaci.
 *
 * Po success: trigger order-completed (tickety + emaily) přes internal API.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handleBenefitCallback } from '@/lib/payment/benefits';

const schema = z.object({
  provider: z.enum(['pluxee', 'benefit_plus', 'gallery_beta', 'edenred']),
  externalId: z.string().uuid(),
  success: z.boolean(),
  payload: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const result = await handleBenefitCallback({
    provider: parsed.data.provider,
    externalId: parsed.data.externalId,
    success: parsed.data.success,
    payload: parsed.data.payload ?? {},
  });

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'PAYMENT_NOT_FOUND' }, { status: 404 });
  }

  if (result.status === 'paid' && result.orderId) {
    // Fire-and-forget trigger order-completed
    void (async () => {
      try {
        const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
        if (!internalToken) return;
        const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
        await fetch(`${appUrl}/api/internal/order-completed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
          body: JSON.stringify({ orderId: result.orderId }),
        });
      } catch (err) {
        console.error('[benefit callback] order-completed trigger failed:', err);
      }
    })();
  }

  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    status: result.status,
  });
}
