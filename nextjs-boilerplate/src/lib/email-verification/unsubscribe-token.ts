/**
 * Stateless unsubscribe token (HMAC-signed, dlouhá TTL).
 *
 * Format: `${userIdHex}.${scope}.${sig}` → base64url.
 * Scope: 'marketing' | 'promoter_news' | 'all'
 *
 * Žádná expiry — unsubscribe link by měl fungovat i 5 let starý.
 * Bezpečnost: HMAC tajný klíč chrání před uhodnutím; nikoliv proti otevření
 * emailu třetí stranou (proto unsubscribe scope se nepoužívá pro autentizaci,
 * jen jako jednorázová opt-out akce).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Buffer } from 'node:buffer';
import { resolveSecret } from '@/lib/security/secrets';

export type UnsubScope = 'marketing' | 'promoter_news' | 'all';

function getSecret(): string {
  return resolveSecret(
    process.env.EMAIL_VERIFY_SECRET ?? process.env.JWT_SECRET,
    'EMAIL_VERIFY_SECRET (or JWT_SECRET)',
    'demo',
  );
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(payload: string): string {
  return base64url(createHmac('sha256', getSecret()).update('unsub:' + payload).digest());
}

export function issueUnsubscribeToken(userId: string, scope: UnsubScope = 'all'): string {
  const userIdHex = userId.replace(/-/g, '');
  const payload = `${userIdHex}.${scope}`;
  const sig = sign(payload);
  return base64url(Buffer.from(`${payload}.${sig}`, 'utf-8'));
}

export interface VerifiedUnsubToken {
  userId: string;
  scope: UnsubScope;
}

export function verifyUnsubscribeToken(token: string): VerifiedUnsubToken | null {
  try {
    const decoded = base64urlDecode(token).toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [userIdHex, scope, sig] = parts as [string, string, string];
    if (scope !== 'marketing' && scope !== 'promoter_news' && scope !== 'all') return null;

    const expected = sign(`${userIdHex}.${scope}`);
    const a = Buffer.from(sig, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    if (userIdHex.length !== 32) return null;
    const userId = [
      userIdHex.slice(0, 8),
      userIdHex.slice(8, 12),
      userIdHex.slice(12, 16),
      userIdHex.slice(16, 20),
      userIdHex.slice(20, 32),
    ].join('-');

    return { userId, scope: scope as UnsubScope };
  } catch {
    return null;
  }
}
