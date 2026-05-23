/**
 * DPP (Dopravní podnik hl. m. Prahy) transit pass integration.
 *
 * DPP provozuje pražskou MHD + chytrá Lítačka. Bez partnership smlouvy
 * není možné registrovat passy programaticky — to je business lead (měsíce).
 *
 * Env:
 *   - DPP_API_KEY          — partner token přidělený DPP
 *   - DPP_API_BASE_URL     — default 'https://api.dpp.cz' (sandbox má jiný)
 *   - DPP_PARTNER_CODE     — partner identifier v DPP systému ('tixly')
 *
 * **Vendor docs nemáme** — endpointy + payload tvary jsou best-effort
 * podle typického REST + Bearer auth patternu. Reálný shape se může lišit
 * a real validation je nutná v sandbox testu před produkčním nasazením.
 *
 * Reference:
 *   - DPP B2B partner portal: business@dpp.cz
 *   - Chytrá Lítačka API spec: dostupný jen partnerům
 */
import type { IssueTransitPassInput } from '../dpp';

const DEFAULT_BASE_URL = 'https://api.dpp.cz';

interface DppPassResponse {
  passId: string;
  qrPayload: string;
  signature: string;
  validFrom: string;
  validUntil: string;
}

export async function createDppPass(
  input: IssueTransitPassInput,
): Promise<{ validationSignature: string; qrPayload: string }> {
  const apiKey = process.env.DPP_API_KEY;
  if (!apiKey) throw new Error('DPP_API_KEY required');
  const baseUrl = process.env.DPP_API_BASE_URL ?? DEFAULT_BASE_URL;
  const partnerCode = process.env.DPP_PARTNER_CODE ?? 'tixly';

  const res = await fetch(`${baseUrl}/v1/passes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Idempotency-Key zaručí, že opakovaný request pro stejný order
      // nevytvoří duplicit pass (důležité při retry po network fail).
      'Idempotency-Key': input.orderId,
    },
    body: JSON.stringify({
      partner: partnerCode,
      externalRef: input.orderId,
      zones: input.zones,
      validFrom: input.validFrom.toISOString(),
      validUntil: input.validUntil.toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<empty>');
    throw new Error(`DPP create pass failed: ${res.status} ${body.slice(0, 300)}`);
  }

  const body = (await res.json()) as DppPassResponse;
  if (!body.qrPayload || !body.signature) {
    throw new Error('DPP response missing qrPayload or signature');
  }
  return {
    qrPayload: body.qrPayload,
    validationSignature: body.signature,
  };
}
