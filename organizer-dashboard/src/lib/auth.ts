// =============================================================================
// Auth helpers — JWT claim ověření pro API routes
// =============================================================================

import { NextRequest } from "next/server";

export interface JwtClaims {
  sub: string;           // user UUID
  organizerId: string;   // organizer UUID (může být stejné jako sub)
  role: "user" | "organizer" | "admin";
  iat: number;
  exp: number;
}

/**
 * Extrahuje a ověří JWT claims z Authorization: Bearer <token> hlavičky.
 * V produkci: ověřit RS256 podpis pomocí veřejného klíče.
 * Zde: typově bezpečný stub pro Next.js App Router.
 */
export async function getAuthClaims(
  req: NextRequest
): Promise<JwtClaims | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) return null;

  // TODO(production): jose verifyJwt(token, RS256_PUBLIC_KEY)
  // Stub: dekóduj payload (base64url prostřední část JWT)
  try {
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8")
    ) as JwtClaims;

    if (Date.now() / 1000 > payload.exp) {
      return null; // token expiroval
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Ověří, zda má přihlášený uživatel přístup k datům daného organizátora.
 * Přístup mají: sám organizátor (claims.organizerId === organizerId) nebo admin.
 */
export function canAccessOrganizerData(
  claims: JwtClaims,
  organizerId: string
): boolean {
  if (claims.role === "admin") return true;
  return claims.organizerId === organizerId;
}
