/**
 * PKCE (RFC 7636) code challenge verification.
 *
 * - `plain`: verifier equals challenge
 * - `S256`:  challenge = BASE64URL(SHA256(verifier))
 */
import { createHash, randomBytes } from 'crypto';

export type PkceMethod = 'plain' | 'S256';

export function verifyPkce(verifier: string, challenge: string, method: PkceMethod): boolean {
  if (!verifier || !challenge) return false;
  if (verifier.length < 43 || verifier.length > 128) return false;

  if (method === 'plain') {
    return timingSafeEqual(verifier, challenge);
  }

  if (method === 'S256') {
    const hash = createHash('sha256').update(verifier).digest();
    const expected = base64url(hash);
    return timingSafeEqual(expected, challenge);
  }

  return false;
}

export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

export function generateCodeChallenge(verifier: string, method: PkceMethod = 'S256'): string {
  if (method === 'plain') return verifier;
  return base64url(createHash('sha256').update(verifier).digest());
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
