// =============================================================================
// GoPay webhook — /api/gopay/webhook
//
// GoPay posílá oznámení jako HTTP GET nebo POST s query parametry:
//   ?id=PAYMENT_ID&parent_id=GOID
//
// Handler VŽDY re-fetchuje stav přes getGopayPayment (anti-spoofing),
// takže samotné query parametry nemusíme kryptograficky ověřovat.
// Vždy vracíme 200 OK, aby GoPay nezařadilo naši URL do retry-backoff fronty.
// =============================================================================

import { NextResponse } from 'next/server';
import { handleGopayWebhook } from '../../../../services/gopay-payment.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import type { GopayWebhookPayload } from '../../../../types/gopay.js';

async function handle(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') ?? '';

    let orderNumber = '';
    let status: string = 'CREATED';

    if (request.method === 'POST') {
      try {
        const body = (await request.json()) as Partial<GopayWebhookPayload>;
        orderNumber = body.orderNumber ?? '';
        status = body.status ?? 'CREATED';
      } catch {
        // Ignoruj — re-fetch stejně použije autoritativní stav.
      }
    }

    const payload: GopayWebhookPayload = {
      id,
      orderNumber,
      status: status as GopayWebhookPayload['status'],
    };

    const deps = getServiceDeps();
    await handleGopayWebhook(payload, deps);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[gopay webhook] error:', err);
    // Vždy 200 OK — chybu logujeme, ale GoPay nemá opakovaně zkoušet.
    return NextResponse.json({ ok: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
