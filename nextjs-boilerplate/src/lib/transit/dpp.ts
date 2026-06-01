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

import { createHmac } from 'crypto';

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

export class TransitProviderUnavailableError extends Error {
  readonly code = 'TRANSIT_PROVIDER_UNAVAILABLE' as const;
  constructor(
    readonly partnerSlug: string,
    readonly reason: 'no_credentials' | 'no_handler' | 'vendor_call_failed',
  ) {
    super(
      `Transit provider ${partnerSlug} unavailable: ${reason}. ` +
        `DPP partnership + DPP_API_KEY required for production, ` +
        `set TRANSIT_DEV_MOCK_FALLBACK=1 to use signed mock pass.`,
    );
    this.name = 'TransitProviderUnavailableError';
  }
}

export type TransitProviderHandler = (
  input: IssueTransitPassInput,
) => Promise<{ validationSignature: string; qrPayload: string }>;

// Per-partner real implementace. Slug → handler. Real handlery v
// src/lib/transit/partners/ — best-effort REST shape, real validation v
// sandbox testu nutná před produkčním nasazením.
//
// Pokud handler hodí (vendor 4xx/5xx, parse fail), issueTransitPass to
// převede na TransitProviderUnavailableError s reason='vendor_call_failed'.
import { createDppPass, createIdosBrnoPass } from './partners';

const PARTNER_HANDLERS: Record<string, TransitProviderHandler | undefined> = {
  dpp: createDppPass,
  'idos-brno': createIdosBrnoPass,
};

function shouldUseMock(): boolean {
  if (process.env.TRANSIT_DEV_MOCK_FALLBACK === '1') return true;
  return process.env.NODE_ENV !== 'production';
}

export async function issueTransitPass(
  input: IssueTransitPassInput,
): Promise<TransitPassResult> {
  const handler = PARTNER_HANDLERS[input.partnerSlug];
  const hasCreds = !isMockMode();

  // Real vendor path — pokud handler hodí (vendor 4xx/5xx, network, parse),
  // konvertujeme na typed error aby caller mohl 503 buyerovi.
  if (hasCreds && handler) {
    try {
      const real = await handler(input);
      return {
        validationSignature: real.validationSignature,
        qrPayload: real.qrPayload,
        isMock: false,
      };
    } catch (err) {
      console.error(`[transit ${input.partnerSlug}] vendor call failed`, err);
      throw new TransitProviderUnavailableError(
        input.partnerSlug,
        'vendor_call_failed',
      );
    }
  }

  // Mock fallback (dev/CI nebo TRANSIT_DEV_MOCK_FALLBACK=1)
  if (shouldUseMock()) {
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

  // Produkce + chybějící real handler/credentials → fail loud (ne silent throw)
  throw new TransitProviderUnavailableError(
    input.partnerSlug,
    !hasCreds ? 'no_credentials' : 'no_handler',
  );
}
