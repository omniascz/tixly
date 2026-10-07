import { cookies } from 'next/headers';
import { isAccessTokenPayload } from '@/lib/security/token-type';
import { jwtVerify } from 'jose';
import {
  db,
  runWithPromoterContext,
  runWithUserContext,
  runWithPlatformAdminContext,
  runWithServiceContext,
} from './db/rls-pool';

/**
 * Server-side čtení rolí z accessToken cookie (pro layout guardy — defense in depth
 * vedle middleware). Jen jose, žádné těžké importy. Vrací null, pokud není platný token.
 */
export async function getServerRoles(): Promise<{
  isPlatformAdmin: boolean;
  hasPromoter: boolean;
  /** Role aktivního členství (owner/manager/staff…) — pro role-scoped navigaci. */
  promoterRole: string | null;
} | null> {
  const token = (await cookies()).get('accessToken')?.value;
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    if (!isAccessTokenPayload(payload)) return null; // FIX K4d
    const roles = (payload as {
      roles?: {
        isPlatformAdmin?: boolean;
        promoterMemberships?: { status?: string; role?: string }[];
      };
    }).roles;
    const memberships = Array.isArray(roles?.promoterMemberships)
      ? roles!.promoterMemberships!
      : [];
    // Stejné pořadí jako requirePromoter: aktivní členství má přednost.
    const active = memberships.find((m) => m?.status === 'active') ?? memberships[0];
    return {
      isPlatformAdmin: roles?.isPlatformAdmin === true,
      hasPromoter: memberships.length > 0,
      promoterRole: active?.role ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Ověří accessToken cookie a vrátí { userId, isPlatformAdmin }. Stejný zdroj pravdy
 * jako middleware (payload.sub + roles.isPlatformAdmin). Null = nepřihlášen/neplatný.
 */
async function getServerAuth(): Promise<{ userId: string; isPlatformAdmin: boolean } | null> {
  const token = (await cookies()).get('accessToken')?.value;
  if (!token) return null;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    if (!isAccessTokenPayload(payload)) return null; // FIX K4d
    const userId = typeof payload.sub === 'string' ? payload.sub : null;
    if (!userId) return null;
    const roles = (payload as { roles?: { isPlatformAdmin?: boolean } }).roles;
    return { userId, isPlatformAdmin: roles?.isPlatformAdmin === true };
  } catch {
    return null;
  }
}

/**
 * RLS context wrappery pro SERVER-COMPONENT stránky (RSC), které čtou tenant data.
 *
 * API routes berou kontext z `req` (admin-auth.ts/auth.ts). Server komponenty req nemají,
 * čtou auth z `accessToken` cookie. Pod ENFORCED RLS (Fáze 2) musí RSC stránka nastavit
 * stejný kontext, jinak `db()` bez kontextu vrátí 0 řádků. Bez wrapperu např.
 * admin/orders/[orderId]/page.tsx vrátí prázdno (a navíc dnes nemá promoter filtr =
 * IDOR — RLS to po obalení opraví: vidí jen objednávku své akce).
 *
 * Vrací null, pokud uživatel není přihlášen / nemá příslušné oprávnění — stránka
 * to ošetří (notFound/redirect).
 */
export async function runAsServerPromoter<T>(
  fn: (ctx: { userId: string; promoterId: string }) => Promise<T>,
): Promise<T | null> {
  const auth = await getServerAuth();
  if (!auth) return null;
  // membership lookup čte promoter_members (RLS) PŘED vznikem kontextu → service kontext
  const res = await runWithServiceContext(() =>
    db().query<{ promoter_id: string }>(
      `SELECT pm.promoter_id
         FROM platform.promoter_members pm
         JOIN platform.promoters p ON p.id = pm.promoter_id
        WHERE pm.user_id = $1
        ORDER BY (p.status = 'active') DESC, p.created_at ASC
        LIMIT 1`,
      [auth.userId],
    ),
  );
  const promoterId = res.rows[0]?.promoter_id;
  if (!promoterId) return null;
  return runWithPromoterContext(promoterId, () => fn({ userId: auth.userId, promoterId }));
}

export async function runAsServerUser<T>(
  fn: (ctx: { userId: string }) => Promise<T>,
): Promise<T | null> {
  const auth = await getServerAuth();
  if (!auth) return null;
  return runWithUserContext(auth.userId, () => fn({ userId: auth.userId }));
}

export async function runAsServerPlatformAdmin<T>(fn: () => Promise<T>): Promise<T | null> {
  const auth = await getServerAuth();
  if (!auth || !auth.isPlatformAdmin) return null;
  return runWithPlatformAdminContext(fn);
}
