/**
 * Limity vytváření objednávek (FIX K3) — JEDNO místo pro všechny cesty, které zakládají
 * pending objednávku a drží jí kapacitu (web checkout, mobile/payment-intent).
 *
 *  - per IP: 10 objednávek / 10 min, SDÍLENÝ klíč `checkout:ip:<ip>` pro všechny cesty
 *    (jinak by stačilo střídat web a mobil a limit zdvojnásobit);
 *  - per kupující: max 5 současně živých (nevypršelých) nezaplacených objednávek.
 *
 * Vrací hotovou 429 odpověď, nebo null (= pokračuj).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';

export const ORDER_IP_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };
export const MAX_LIVE_PENDING_ORDERS = 5;

export async function enforceOrderCreationLimits(
  req: NextRequest,
  buyer: { email: string } | { userId: string },
): Promise<Response | null> {
  const { checkRateLimit, rateLimitResponse } = await import('@/lib/rate-limit/per-tenant');
  const { clientIp } = await import('@/lib/security/client-ip');
  const rl = await checkRateLimit(`checkout:ip:${clientIp(req)}`, ORDER_IP_LIMIT);
  const rlResp = rateLimitResponse(rl, 'checkout');
  if (rlResp) return rlResp;

  const pendingRes = 'email' in buyer
    ? await db().query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM orders.orders o
           JOIN identity.users u ON u.id = o.user_id
          WHERE LOWER(u.email) = LOWER($1)
            AND o.status = 'pending'
            AND o.expires_at > now()`,
        [buyer.email],
      )
    : await db().query<{ n: number }>(
        `SELECT COUNT(*)::int AS n
           FROM orders.orders o
          WHERE o.user_id = $1
            AND o.status = 'pending'
            AND o.expires_at > now()`,
        [buyer.userId],
      );
  if ((pendingRes.rows[0]?.n ?? 0) >= MAX_LIVE_PENDING_ORDERS) {
    return NextResponse.json(
      {
        error: 'TOO_MANY_PENDING_ORDERS',
        message: 'Máte příliš mnoho nezaplacených objednávek. Dokončete je, nebo počkejte, než vyprší.',
      },
      { status: 429 },
    );
  }
  return null;
}
