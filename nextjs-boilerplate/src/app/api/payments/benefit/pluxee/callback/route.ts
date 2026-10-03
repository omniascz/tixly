/**
 * POST /api/payments/benefit/pluxee/callback?external_id=<uuid>
 *
 * Pluxee vendor → Tixly callback. Vendor pošle raw JSON body s payment
 * status + HMAC signature v X-Pluxee-Signature header.
 *
 * Verifikace: raw body → HMAC-SHA256 s PLUXEE_CALLBACK_SECRET. Pokud
 * signature nesouhlasí, 401 (možný spoofing).
 *
 * Po verify: delegujeme do shared handleBenefitCallback (idempotent UPDATE
 * order status + trigger order-completed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { handleBenefitCallback } from '@/lib/payment/benefits';
import { runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyPluxeeCallback } from '@/lib/payment/benefit-providers';

interface PluxeeCallbackBody {
  transactionId?: string;
  merchantTransactionId?: string;
  status?: 'paid' | 'failed' | 'pending';
  paidAmountMinor?: number;
  currency?: string;
  paidAt?: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  // 1) Read raw body PŘED .json() parsování (pro HMAC verify nad raw bytes)
  const rawBody = await req.text();

  // 2) Signature verify — pokud chybí secret nebo signature, 401
  const sig = req.headers.get('x-pluxee-signature');
  const verifyOk = verifyPluxeeCallback(rawBody, sig);
  // Kolo 2: dev obejití ověření NIKDY v produkci (dřív stačilo nastavit env i tam).
  const devSkip = process.env.BENEFIT_DEV_SKIP_CALLBACK_VERIFY === '1' && process.env.NODE_ENV !== 'production';
  if (!verifyOk && !devSkip) {
    console.warn('[pluxee callback] signature verify failed');
    return NextResponse.json(
      { error: 'INVALID_SIGNATURE' },
      { status: 401 },
    );
  }

  // 3) Parse body
  let body: PluxeeCallbackBody;
  try {
    body = JSON.parse(rawBody) as PluxeeCallbackBody;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 422 });
  }

  // 4) Resolve externalId — buď v body nebo v query
  const externalId =
    body.merchantTransactionId ??
    req.nextUrl.searchParams.get('external_id') ??
    '';
  if (!externalId || !/^[0-9a-f-]{36}$/i.test(externalId)) {
    return NextResponse.json({ error: 'MISSING_EXTERNAL_ID' }, { status: 422 });
  }

  // 5) Determine success
  const success = body.status === 'paid';

  // 6) Delegate to shared handler (idempotent, order status update)
  // Kolo 2: servisní kontext — pod tixly_app (RLS) by jinak benefit_payments/orders
  // nebyly vidět a každý (i legitimní) callback skončil 404.
  // Pluxee vendor API (dotaz na stav) zatím nemáme zdokumentované → rozhoduje podepsaná
  // notifikace + kontrola, že zaplacená částka pokrývá cenu.
  const result = await runWithServiceContext(() => handleBenefitCallback({
    provider: 'pluxee',
    externalId,
    success,
    payload: body as Record<string, unknown>,
    paidAmountMinor: success ? (body.currency === 'CZK' ? body.paidAmountMinor ?? null : null) : undefined,
  }));
  if (result.status === 'amount_mismatch') {
    return NextResponse.json({ error: 'AMOUNT_MISMATCH' }, { status: 409 });
  }

  if (result.status === 'not_found') {
    return NextResponse.json({ error: 'PAYMENT_NOT_FOUND' }, { status: 404 });
  }

  // 7) Trigger order-completed fire-and-forget (tickety + emaily)
  if (result.status === 'paid' && result.orderId) {
    void (async () => {
      try {
        const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
        if (!internalToken) return;
        const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
        await fetch(`${appUrl}/api/internal/order-completed`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-token': internalToken,
          },
          body: JSON.stringify({ orderId: result.orderId }),
        });
      } catch (err) {
        console.error(
          '[pluxee callback] order-completed trigger failed:',
          err,
        );
      }
    })();
  }

  return NextResponse.json({
    ok: true,
    orderId: result.orderId,
    status: result.status,
  });
}
