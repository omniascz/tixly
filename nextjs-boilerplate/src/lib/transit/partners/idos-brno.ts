/**
 * IDOS Brno (DPMB — Dopravní podnik města Brna) transit pass integration.
 *
 * Brno IDS JMK (Integrovaný dopravní systém Jihomoravského kraje) má
 * vlastní pass API přes KORDIS. Bez partnership smlouvy nepoužitelné
 * v produkci.
 *
 * Env:
 *   - IDOS_BRNO_API_KEY      — KORDIS partner token
 *   - IDOS_BRNO_API_BASE_URL — default 'https://api.kordis-jmk.cz'
 *
 * **Vendor docs nemáme.** Best-effort REST shape.
 */
import type { IssueTransitPassInput } from '../dpp';

const DEFAULT_BASE_URL = 'https://api.kordis-jmk.cz';

interface IdosBrnoPassResponse {
  ticketId: string;
  qrCode: string;
  hmac: string;
}

export async function createIdosBrnoPass(
  input: IssueTransitPassInput,
): Promise<{ validationSignature: string; qrPayload: string }> {
  const apiKey = process.env.IDOS_BRNO_API_KEY;
  if (!apiKey) throw new Error('IDOS_BRNO_API_KEY required');
  const baseUrl = process.env.IDOS_BRNO_API_BASE_URL ?? DEFAULT_BASE_URL;

  const res = await fetch(`${baseUrl}/v1/tickets/issue`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': input.orderId,
    },
    body: JSON.stringify({
      externalReference: input.orderId,
      zones: input.zones,
      validityStart: input.validFrom.toISOString(),
      validityEnd: input.validUntil.toISOString(),
      product: 'EVENT_COMBO',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new Error(
      `IDOS Brno create pass failed: ${res.status} ${body.slice(0, 300)}`,
    );
  }

  const body = (await res.json()) as IdosBrnoPassResponse;
  if (!body.qrCode || !body.hmac) {
    throw new Error('IDOS Brno response missing qrCode or hmac');
  }
  return {
    qrPayload: body.qrCode,
    validationSignature: body.hmac,
  };
}
