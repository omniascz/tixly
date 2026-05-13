import { NextRequest } from 'next/server';
import { createPublicKey, verify } from 'crypto';

// =============================================================================
// JWT RS256 authentication helper
// Validates the Authorization: Bearer <token> header and returns the userId
// claim from the token payload. Returns null on any validation failure.
// =============================================================================

interface JwtPayload {
  sub: string;
  exp: number;
  iat: number;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

export async function getAuthenticatedUserId(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  const publicKeyPem = process.env.JWT_PUBLIC_KEY;
  if (!publicKeyPem) {
    console.error('[auth] JWT_PUBLIC_KEY not configured');
    return null;
  }

  try {
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = base64UrlDecode(signatureB64);
    const publicKey = createPublicKey(publicKeyPem);

    const isValid = verify(
      'sha256',
      Buffer.from(signingInput, 'utf8'),
      { key: publicKey, padding: 1 }, // RSA_PKCS1_PADDING
      signature
    );

    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as JwtPayload;

    if (Math.floor(Date.now() / 1000) > payload.exp) return null;

    return payload.sub;
  } catch {
    return null;
  }
}
