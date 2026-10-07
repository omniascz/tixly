/**
 * Kolo 14 / krok 3 — upozornění provozu při selhání webhooku platební brány.
 *
 * Webhook, který skončí 5xx (kromě řízeného 503 při přetížení — brána ho sama zopakuje), výjimkou, nebo 401 kvůli
 * chybějící konfiguraci (…_NOT_CONFIGURED), pošle upozornění na PLATFORM_ADMIN_EMAIL (nejvýš 1 za 30 min na bránu).
 * Neplatný podpis (401 INVALID_SIGNATURE / INVALID_SECRET) se nehlásí — to je cizí požadavek, ne selhání.
 */
import { alertOps } from '@/lib/ops/alerts';

async function notify(provider: string, req: Request, what: string): Promise<void> {
  const url = new URL(req.url);
  await alertOps({
    kind: 'gateway_webhook_failed',
    key: `gateway_webhook_failed:${provider}`,
    subject: `Selhal webhook brány ${provider}`,
    text: `Webhook platební brány ${provider} selhal: ${what}\n`
      + `Požadavek: ${req.method} ${url.pathname}${url.search}\n\n`
      + 'Platba mohla proběhnout, ale objednávka se nemusela označit jako zaplacená a vstupenky se nevystavily. '
      + 'Brána webhook obvykle opakuje; zkontrolujte objednávku podle ID platby a logy funkce.',
  });
}

export async function withWebhookAlert(provider: string, req: Request, handler: () => Promise<Response>): Promise<Response> {
  let res: Response;
  try {
    res = await handler();
  } catch (err) {
    await notify(provider, req, `výjimka — ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
  const isFailure = (res.status >= 500 && res.status !== 503) || res.status === 401;
  if (isFailure) {
    const body = await res.clone().text().catch(() => '');
    // 401 jen při chybějící konfiguraci (ne při cizím / padělaném požadavku)
    if (res.status !== 401 || /NOT_CONFIGURED/.test(body)) {
      await notify(provider, req, `HTTP ${res.status} ${body.slice(0, 300)}`);
    }
  }
  return res;
}
