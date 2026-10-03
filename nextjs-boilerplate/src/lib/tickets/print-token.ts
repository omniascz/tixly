/**
 * Print token — kompaktní podepsaný kód pro TIŠTĚNOU vstupenku (104mm ticket
 * label, à la SMSticket). Na rozdíl od rotujícího TOTP je STATICKÝ a dlouhodobě
 * platný: tištěná vstupenka se po vytisknutí nemění a musí jít odbavit offline
 * u brány.
 *
 * Formát:  TXP1.<base64url( uuid16 ‖ hmac10 )>
 *   - uuid16 = 16 raw bytů ticket UUID (bez pomlček)
 *   - hmac10 = prvních 10 bytů HMAC-SHA256(key, "TXP1" ‖ uuid16)
 *   - výsledek ~40 znaků → QR verze ~3 (29×29), čitelný i na úzké šířce.
 *
 * Bezpečnost: HMAC zabraňuje vyrobit "validně vypadající" kód bez znalosti
 * NFC_SIGNING_KEY. Rotací klíče lze zneplatnit všechny vytištěné tokeny.
 * Token NEpřenáší TOTP — scanner po ověření podpisu pokračuje ID-based cestou
 * (funguje pro qr_policy=static_allowed; rotating_only/photo_required ho odmítne
 * stejně jako PDF, protože vyžadují živý mobilní QR).
 *
 * Sdílí klíč i b64url helpery se [[safetix/group-token]] (stejný NFC_SIGNING_KEY).
 */
import crypto from 'node:crypto';
import { resolveSecret } from '@/lib/security/secrets';

const SCHEME = 'TXP1';
const HMAC_BYTES = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}
function bytesToUuid(buf: Buffer): string {
  const h = buf.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function sign(uuidBytes: Buffer): Buffer {
  return crypto
    .createHmac('sha256', getKey())
    .update(SCHEME)
    .update(uuidBytes)
    .digest()
    .subarray(0, HMAC_BYTES);
}

export function signPrintToken(ticketId: string): string {
  if (!UUID_RE.test(ticketId)) {
    throw new Error('signPrintToken: ticketId must be a UUID');
  }
  const uuidBytes = uuidToBytes(ticketId);
  const sig = sign(uuidBytes);
  return `${SCHEME}.${b64url(Buffer.concat([uuidBytes, sig]))}`;
}

export interface PrintTokenResult {
  ok: boolean;
  ticketId?: string;
  reason?: 'malformed' | 'invalid_signature';
}

/** Rozpozná, jestli naskenovaný text vypadá jako print token (rychlý client-side guard). */
export function looksLikePrintToken(raw: string): boolean {
  return raw.trim().startsWith(`${SCHEME}.`);
}

export function verifyPrintToken(token: string): PrintTokenResult {
  const trimmed = token.trim();
  if (!trimmed.startsWith(`${SCHEME}.`)) return { ok: false, reason: 'malformed' };
  const body = trimmed.slice(SCHEME.length + 1);
  let raw: Buffer;
  try {
    raw = b64urlDecode(body);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (raw.length !== 16 + HMAC_BYTES) return { ok: false, reason: 'malformed' };
  const uuidBytes = raw.subarray(0, 16);
  const providedSig = raw.subarray(16);
  const expectedSig = sign(uuidBytes);
  if (
    providedSig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    return { ok: false, reason: 'invalid_signature' };
  }
  return { ok: true, ticketId: bytesToUuid(uuidBytes) };
}

// ── TXP2: tiskový token vázaný na vstupenku I akci (kolo 4) ─────────────────────
//
// Formát:  TXP2.<base64url( uuid16 ‖ hmac12 )>,  hmac = HMAC-SHA256(key, "TXP2" ‖ ticket16 ‖ event16)
//
// Akce v tokenu NENÍ — skener ji zná z DB (vstupenka → objednávka → akce) a podpis ověří
// proti ní. Vstupenka převedená na jiný termín tak starým papírem neprojde (nový tisk).
// Na rozdíl od TXP1 platný TXP2 nahrazuje TOTP u qr_policy static_allowed i rotating_24h:
// tištěná vstupenka TOTP mít nemůže a podpis vázaný na akci je silnější než holé UUID.
// rotating_only / photo_required ho dál odmítají (vyžadují živý mobilní QR).

const SCHEME2 = 'TXP2';
const HMAC2_BYTES = 12;

function sign2(ticketBytes: Buffer, eventBytes: Buffer): Buffer {
  return crypto
    .createHmac('sha256', getKey())
    .update(SCHEME2)
    .update(ticketBytes)
    .update(eventBytes)
    .digest()
    .subarray(0, HMAC2_BYTES);
}

export function signEventPrintToken(ticketId: string, eventId: string): string {
  if (!UUID_RE.test(ticketId) || !UUID_RE.test(eventId)) {
    throw new Error('signEventPrintToken: ticketId i eventId musí být UUID');
  }
  const t = uuidToBytes(ticketId);
  return `${SCHEME2}.${b64url(Buffer.concat([t, sign2(t, uuidToBytes(eventId))]))}`;
}

export interface ParsedPrintToken {
  scheme: 'TXP1' | 'TXP2';
  ticketId: string;
}

/** Vyčte schéma a ID vstupenky BEZ ověření podpisu (podpis TXP2 potřebuje akci z DB). */
export function parsePrintToken(token: string): ParsedPrintToken | null {
  const trimmed = token.trim();
  const scheme = trimmed.startsWith(`${SCHEME2}.`) ? SCHEME2 : trimmed.startsWith(`${SCHEME}.`) ? SCHEME : null;
  if (!scheme) return null;
  let raw: Buffer;
  try {
    raw = b64urlDecode(trimmed.slice(scheme.length + 1));
  } catch {
    return null;
  }
  const expected = 16 + (scheme === SCHEME2 ? HMAC2_BYTES : HMAC_BYTES);
  if (raw.length !== expected) return null;
  return { scheme, ticketId: bytesToUuid(raw.subarray(0, 16)) };
}

/**
 * Ověří podpis tiskového tokenu pro akci, ke které vstupenka v DB patří.
 * TXP1 (bez vazby na akci) se ověřuje jako dřív; TXP2 proti `eventId`.
 */
export function verifyPrintTokenForEvent(token: string, eventId: string): PrintTokenResult & { scheme?: 'TXP1' | 'TXP2' } {
  const parsed = parsePrintToken(token);
  if (!parsed) return { ok: false, reason: 'malformed' };
  if (parsed.scheme === SCHEME) return { ...verifyPrintToken(token), scheme: SCHEME };
  if (!UUID_RE.test(eventId)) return { ok: false, reason: 'invalid_signature' };
  const raw = b64urlDecode(token.trim().slice(SCHEME2.length + 1));
  const ticketBytes = raw.subarray(0, 16);
  const provided = raw.subarray(16);
  const expected = sign2(ticketBytes, uuidToBytes(eventId));
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'invalid_signature', scheme: SCHEME2 };
  }
  return { ok: true, ticketId: parsed.ticketId, scheme: SCHEME2 };
}

/** Klientský guard: vypadá text jako tiskový token (TXP1 nebo TXP2)? */
export function looksLikeAnyPrintToken(raw: string): boolean {
  return /^TXP[12]\./.test(raw.trim());
}
