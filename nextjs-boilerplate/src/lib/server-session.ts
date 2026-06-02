import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

/**
 * Server-side čtení rolí z accessToken cookie (pro layout guardy — defense in depth
 * vedle middleware). Jen jose, žádné těžké importy. Vrací null, pokud není platný token.
 */
export async function getServerRoles(): Promise<{
  isPlatformAdmin: boolean;
  hasPromoter: boolean;
} | null> {
  const token = cookies().get('accessToken')?.value;
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    const roles = (payload as {
      roles?: { isPlatformAdmin?: boolean; promoterMemberships?: unknown[] };
    }).roles;
    return {
      isPlatformAdmin: roles?.isPlatformAdmin === true,
      hasPromoter:
        Array.isArray(roles?.promoterMemberships) && roles!.promoterMemberships!.length > 0,
    };
  } catch {
    return null;
  }
}
