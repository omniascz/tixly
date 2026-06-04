/**
 * Group (order-level) token — JEDEN QR odbaví celou objednávku.
 *
 * Lead osoba ve skupině ukáže jeden rotující QR za CELOU objednávku (ne per
 * lístek). Scanner ho přečte, ukáže „10 lístků, 9 volných" a obsluha pustí
 * všechny / jen vybrané (pozdní příchozí se pustí později dalším skenem).
 *
 * Anti-screenshot: TTL 60 s → přeposlaný screenshot je za minutu neplatný.
 * Buyer app si token periodicky obnovuje (GET /api/buyer/orders/[id]/group-qr).
 * Algoritmus: HMAC-SHA256 s NFC_SIGNING_KEY (stejný secret jako SafeTix NFC).
 */
import crypto from 'node:crypto';

const TTL_SECONDS = 60;

export interface GroupPayload {
  orderId: string;
  iat: number;
  exp: number;
}

function getKey(): Buffer {
  const k = process.env.NFC_SIGNING_KEY ?? process.env.JWT_SECRET ?? 'dev-nfc-secret-fallback';
  return Buffer.from(k, 'utf8');
}
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s: string): Buffer {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function signGroupToken(orderId: string): { token: string; exp: number } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TTL_SECONDS;
  const payload: GroupPayload = { orderId, iat, exp };
  const header = { alg: 'HS256', typ: 'GRP' };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', getKey()).update(signingInput).digest();
  return { token: `${signingInput}.${b64url(sig)}`, exp };
}

export interface GroupVerifyResult {
  ok: boolean;
  reason?: 'malformed' | 'invalid_signature' | 'expired';
  payload?: GroupPayload;
}

export function verifyGroupToken(token: string): GroupVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', getKey()).update(signingInput).digest();
  let providedSig: Buffer;
  try { providedSig = b64urlDecode(sigB64); } catch { return { ok: false, reason: 'malformed' }; }
  if (providedSig.length !== expectedSig.length || !crypto.timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  let payload: GroupPayload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as GroupPayload; }
  catch { return { ok: false, reason: 'malformed' }; }
  if (!payload.orderId || typeof payload.orderId !== 'string') return { ok: false, reason: 'malformed' };
  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) return { ok: false, reason: 'expired', payload };
  return { ok: true, payload };
}
