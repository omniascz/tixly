/**
 * Mock DPP/Lítačka SDK pro MHD Kombi-Ticket.
 *
 * Production: integrace na DPP API (chytrá Lítačka) vyžaduje partnership
 * smlouvu s DPP — měsíce business lead. Pro CZ je to massive city moat,
 * žádná konkurence to nemá. Tech implementace je triviální, business je hard.
 *
 * Mock mode (default): pokud chybí DPP_API_KEY v env, SDK vrátí valid-looking
 * QR s HMAC signature, kterou inspector může lokálně verifikovat (bez round-trip
 * na DPP server). Production by místo toho registroval pass přes DPP API.
 */

import { createHmac, randomBytes } from 'crypto';

export interface IssueTransitPassInput {
  orderId: string;
  partnerSlug: string;        // 'dpp', 'idos-brno'
  zones: string[];            // ['P', '0', 'B']
  validFrom: Date;
  validUntil: Date;
}

export interface TransitPassResult {
  validationSignature: string;
  qrPayload: string;          // 'tixly-mhd:dpp:{orderId}:{sig}'
  isMock: boolean;
}

export function isMockMode(): boolean {
  return !process.env.DPP_API_KEY;
}

function getSecret(): string {
  return (
    process.env.DPP_VALIDATION_SECRET ??
    process.env.INTERNAL_SERVICE_TOKEN ??
    'tixly-dpp-default-secret'
  );
}

/**
 * Vytvoří validation signature nad orderId+zones+validUntil.
 * Inspector dostane QR payload + zónová info, sám si spočítá HMAC a porovná.
 */
export function signPass(input: {
  orderId: string;
  partnerSlug: string;
  zones: string[];
  validUntil: Date;
}): string {
  const payload = [
    input.orderId,
    input.partnerSlug,
    [...input.zones].sort().join(','),
    input.validUntil.toISOString(),
  ].join('|');
  return createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 32);
}

export function buildQrPayload(input: {
  partnerSlug: string;
  orderId: string;
  signature: string;
}): string {
  return `tixly-mhd:${input.partnerSlug}:${input.orderId}:${input.signature}`;
}

/**
 * Inspector flow: ověří QR z pasu. Vrátí true pokud signature matchne
 * a pas je v validity window. V produkci by se navíc volal DPP API pro
 * online verifikaci (revocation, fraud detection).
 */
export interface VerifyPassInput {
  qrPayload: string;
  zones: string[];
  validFrom: Date;
  validUntil: Date;
  atDate?: Date;
}

export interface VerifyPassResult {
  valid: boolean;
  reason?:
    | 'expired'
    | 'not_yet_valid'
    | 'signature_mismatch'
    | 'malformed_qr'
    | 'wrong_partner';
}

export function verifyPass(input: VerifyPassInput): VerifyPassResult {
  const parts = input.qrPayload.split(':');
  if (parts.length !== 4 || parts[0] !== 'tixly-mhd') {
    return { valid: false, reason: 'malformed_qr' };
  }
  const [, partnerSlug, orderId, signature] = parts;
  const atDate = input.atDate ?? new Date();
  if (atDate < input.validFrom) return { valid: false, reason: 'not_yet_valid' };
  if (atDate > input.validUntil) return { valid: false, reason: 'expired' };

  const expected = signPass({
    orderId,
    partnerSlug,
    zones: input.zones,
    validUntil: input.validUntil,
  });
  if (signature !== expected) return { valid: false, reason: 'signature_mismatch' };
  return { valid: true };
}

export async function issueTransitPass(
  input: IssueTransitPassInput,
): Promise<TransitPassResult> {
  if (isMockMode()) {
    const signature = signPass({
      orderId: input.orderId,
      partnerSlug: input.partnerSlug,
      zones: input.zones,
      validUntil: input.validUntil,
    });
    return {
      validationSignature: signature,
      qrPayload: buildQrPayload({
        partnerSlug: input.partnerSlug,
        orderId: input.orderId,
        signature,
      }),
      isMock: true,
    };
  }
  // Production: POST na DPP API /api/passes
  //   - body: { partner: input.partnerSlug, zones, validFrom, validUntil, externalRef: input.orderId }
  //   - response: { passId, qrPayload, signature }
  //   - error handling: rate limits, retries, idempotency-key = orderId
  throw new Error('Real DPP integration not implemented (require DPP partnership)');
}

void randomBytes; // reserved for future jitter / nonce
