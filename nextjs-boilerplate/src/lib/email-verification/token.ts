/**
 * Stateless e-mail verification token (HMAC-signed).
 *
 * Format: `${userIdHex}.${expSec}.${sig}` — base64url.
 * Sig = HMAC-SHA256(`${userIdHex}.${expSec}`, secret).
 *
 * Bez DB tabulky — TTL je v claims, replay attack mitigován tím, že po
 * úspěšné verifikaci se `email_verified_at` nastaví; další klik je no-op.
 *
 * Secret: `EMAIL_VERIFY_SECRET` env, fallback na `JWT_SECRET` (existuje).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { Buffer } from 'node:buffer';
import { resolveSecret } from '@/lib/security/secrets';

const TTL_SECONDS = 60 * 60 * 24 * 3; // 3 dny

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
  return base64url(createHmac('sha256', getSecret()).update(payload).digest());
}

export function issueEmailVerificationToken(userId: string): string {
  const userIdHex = userId.replace(/-/g, '');
  const expSec = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${userIdHex}.${expSec}`;
  const sig = sign(payload);
  return base64url(Buffer.from(`${payload}.${sig}`, 'utf-8'));
}

export interface VerifiedToken {
  userId: string;
  expSec: number;
}

export function verifyEmailToken(token: string): VerifiedToken | null {
  try {
    const decoded = base64urlDecode(token).toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [userIdHex, expStr, sig] = parts as [string, string, string];

    const expected = sign(`${userIdHex}.${expStr}`);
    const a = Buffer.from(sig, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    const expSec = Number(expStr);
    if (!Number.isFinite(expSec) || expSec * 1000 < Date.now()) return null;

    // Reconstruct UUID format from hex
    if (userIdHex.length !== 32) return null;
    const userId = [
      userIdHex.slice(0, 8),
      userIdHex.slice(8, 12),
      userIdHex.slice(12, 16),
      userIdHex.slice(16, 20),
      userIdHex.slice(20, 32),
    ].join('-');

    return { userId, expSec };
  } catch {
    return null;
  }
}
