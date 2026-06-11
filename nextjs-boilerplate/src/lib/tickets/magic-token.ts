/**
 * Magic token pro veřejný přístup k SMS vstupence.
 *
 * Token = base64url(`${ticketIdHex}.${sig}`) kde sig = HMAC-SHA256(secret, 'ticket:' + ticketIdHex).
 *
 * Použití: SMS s linkem `/cs/t/{token}` → public show page (bez login)
 * Bezpečnost: HMAC chrání před uhodnutím; token je v SMS jen owner-only.
 *
 * Není expiry — token funguje dokud existuje ticket (po revoke=show page sama
 * vyhodí 410).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Buffer } from 'node:buffer';
import { resolveSecret } from '@/lib/security/secrets';

function getSecret(): string {
  return resolveSecret(
    process.env.TICKET_MAGIC_SECRET ?? process.env.JWT_SECRET,
    'TICKET_MAGIC_SECRET (or JWT_SECRET)',
    'demo-ticket-secret',
  );
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(ticketIdHex: string): string {
  return base64url(
    createHmac('sha256', getSecret()).update('ticket:' + ticketIdHex).digest(),
  );
}

export function issueTicketMagicToken(ticketId: string): string {
  const hex = ticketId.replace(/-/g, '');
  const sig = sign(hex);
  return base64url(Buffer.from(`${hex}.${sig}`, 'utf-8'));
}

export function verifyTicketMagicToken(token: string): string | null {
  try {
    const decoded = base64urlDecode(token).toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 2) return null;
    const [hex, providedSig] = parts as [string, string];
    if (hex.length !== 32) return null;

    const expected = sign(hex);
    const a = Buffer.from(providedSig, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  } catch {
    return null;
  }
}
