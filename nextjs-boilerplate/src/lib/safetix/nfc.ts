/**
 * NFC payload signing + verification.
 *
 * Klient (mobil) tapne telefon na NFC scanner u brány. NFC reader přečte
 * krátký signed JWT, server ho verifikuje a propustí. Payload má TTL ~10s
 * aby se nedal cachovat.
 *
 * Algoritmus: HMAC-SHA256 s NFC_SIGNING_KEY (server secret).
 * Payload claims: ticketId, jti (unique id pro replay protection), iat, exp.
 *
 * Replay protection: tickets.nfc_taps má UNIQUE jti.
 */
import crypto from 'node:crypto';
import { resolveSecret } from '@/lib/security/secrets';

const NFC_TTL_SECONDS = 10;

export interface NfcPayload {
  ticketId: string;
  jti: string;
  iat: number;
  exp: number;
}

function getKey(): Buffer {
  const k = resolveSecret(
    process.env.NFC_SIGNING_KEY ?? process.env.JWT_SECRET,
    'NFC_SIGNING_KEY (or JWT_SECRET)',
    'dev-nfc-secret-fallback',
  );
  return Buffer.from(k, 'utf8');
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signNfcPayload(ticketId: string): { token: string; jti: string; exp: number } {
  const jti = crypto.randomUUID();
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + NFC_TTL_SECONDS;
  const payload: NfcPayload = { ticketId, jti, iat, exp };
  const header = { alg: 'HS256', typ: 'NFC' };

  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', getKey()).update(signingInput).digest();
  const token = `${signingInput}.${b64url(sig)}`;

  return { token, jti, exp };
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'malformed' | 'invalid_signature' | 'expired';
  payload?: NfcPayload;
}

export function verifyNfcPayload(token: string): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', getKey()).update(signingInput).digest();

  let providedSig: Buffer;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (providedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  let payload: NfcPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as NfcPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) return { ok: false, reason: 'expired', payload };

  return { ok: true, payload };
}
