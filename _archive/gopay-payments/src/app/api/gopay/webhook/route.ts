// =============================================================================
// GoPay webhook — /api/gopay/webhook
//
// GoPay posílá oznámení jako HTTP GET nebo POST s query parametry:
//   ?id=PAYMENT_ID&parent_id=GOID
//
// Handler VŽDY re-fetchuje stav přes getGopayPayment (anti-spoofing),
// takže samotné query parametry nemusíme kryptograficky ověřovat.
//
// IP allowlist (A13): nastav env GOPAY_WEBHOOK_IP_ALLOWLIST jako čárkou oddělený
// seznam povolených IP adres GoPay. Pokud není nastaven, požadavky jsou povoleny
// (ale logováno varování). GoPay produkční rozsahy: 94.140.206.0/24 + 46.28.103.0/24
//
// Chybové odpovědi (A12): 500 pro přechodné chyby (DB výpadek) → GoPay zopakuje.
// Parse chyby těla vrací 200, protože re-fetch stejně použije autoritativní stav.
// =============================================================================

import { NextResponse } from 'next/server';
import { handleGopayWebhook } from '../../../../services/gopay-payment.service.js';
import { getServiceDeps } from '../../../../lib/service-container.js';
import type { GopayWebhookPayload } from '../../../../types/gopay.js';

// ---------------------------------------------------------------------------
// A13: IP allowlist guard
// ---------------------------------------------------------------------------
function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? '';
}

function checkIpAllowlist(request: Request): boolean {
  const allowlistEnv = process.env.GOPAY_WEBHOOK_IP_ALLOWLIST;
  if (!allowlistEnv) {
    // Not configured — allow but warn. Configure in production.
    // eslint-disable-next-line no-console
    console.warn('[gopay webhook] GOPAY_WEBHOOK_IP_ALLOWLIST not set — all IPs allowed');
    return true;
  }
  const allowed = allowlistEnv.split(',').map((ip) => ip.trim()).filter(Boolean);
  const clientIp = getClientIp(request);
  return allowed.includes(clientIp);
}

async function handle(request: Request): Promise<Response> {
  // A13: Reject requests from unknown IPs when allowlist is configured.
  if (!checkIpAllowlist(request)) {
    // eslint-disable-next-line no-console
    console.warn('[gopay webhook] Rejected request from IP:', getClientIp(request));
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

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
    // A12: Return 5xx for transient errors (DB outage etc.) so GoPay retries.
    // Parse errors are silenced in the inner try/catch above and never reach here.
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}
