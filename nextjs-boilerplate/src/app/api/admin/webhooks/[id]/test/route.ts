/**
 * POST /api/admin/webhooks/[id]/test — pošle test ping na endpoint
 *
 * Payload: { event: 'webhook.test', timestamp, endpoint_id }
 * Signed HMAC SHA-256 v hlavičce X-Tixly-Signature.
 * Vrací status code + body z target serveru pro debug.
 */

import { createHmac } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { assertPublicHttpUrl, SsrfError } from '@/lib/security/ssrf';
import { NextRequest, NextResponse } from 'next/server';


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  const endpoint = await db().query<{ url: string; secret: string }>(
    `SELECT url, secret FROM reservations.webhook_endpoints
     WHERE id = $1 AND promoter_id = $2`,
    [id, promoter.promoterId],
  );
  if (endpoint.rowCount === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { url, secret } = endpoint.rows[0];

  const payload = {
    event: 'webhook.test',
    endpoint_id: id,
    promoter_id: promoter.promoterId,
    timestamp: new Date().toISOString(),
    message: 'Test ping z Tixly admin UI. Pokud vidíš tohle, signature validation funguje.',
  };
  const bodyStr = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(bodyStr).digest('hex');

  const start = Date.now();
  let status: number | null = null;
  let responseBody: string | null = null;
  let errorMsg: string | null = null;

  try {
    // SSRF guard: cíl musí být veřejný http(s) — blokuje 169.254.169.254
    // (cloud metadata), localhost a privátní rozsahy. redirect:'manual' brání
    // obejití přes 30x na interní adresu.
    await assertPublicHttpUrl(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tixly-Signature': signature,
        'X-Tixly-Event': 'webhook.test',
      },
      body: bodyStr,
      signal: controller.signal,
      redirect: 'manual',
    });
    clearTimeout(timeoutId);
    status = r.status;
    responseBody = (await r.text()).slice(0, 1000);
  } catch (err) {
    if (err instanceof SsrfError) {
      return NextResponse.json(
        { ok: false, error: 'URL ukazuje na neveřejný/interní cíl a byla zablokována.' },
        { status: 422 },
      );
    }
    errorMsg = err instanceof Error ? err.message : String(err);
  }
  const durationMs = Date.now() - start;

  return NextResponse.json({
    ok: status !== null && status >= 200 && status < 300,
    status,
    responseBody,
    errorMsg,
    durationMs,
  });

  });
}
