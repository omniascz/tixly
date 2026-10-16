/**
 * POST /api/public/seat-reservations/cancel { code, token } — kupec zruší rezervaci odkazem z e-mailu (kolo 8 / krok 5).
 * Bez přihlášení; ověřuje kód + jednorázový token (v DB jen hash). Místa se vrátí do prodeje, kupci odejde potvrzení.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { cancelReservationByToken, ReservationError, sendReservationMail } from '@/lib/theatre/reservations';

export const dynamic = 'force-dynamic';
const schema = z.object({ code: z.string().regex(/^[A-Za-z0-9]{6,12}$/), token: z.string().min(16).max(100) });

export async function POST(req: NextRequest): Promise<Response> {
  const { checkRateLimit, rateLimitResponse } = await import('@/lib/rate-limit/per-tenant');
  const { clientIp } = await import('@/lib/security/client-ip');
  const rl = rateLimitResponse(await checkRateLimit(`seat-reservation-cancel:ip:${clientIp(req)}`, { limit: 20, windowMs: 10 * 60 * 1000 }), 'zrušení rezervace');
  if (rl) return rl;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  return runWithServiceContext(async () => {
    const client = await db().connect();
    let r: Awaited<ReturnType<typeof cancelReservationByToken>>;
    try {
      await client.query('BEGIN');
      r = await cancelReservationByToken(client, parsed.data.code, parsed.data.token);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof ReservationError) return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
      throw err;
    } finally {
      client.release();
    }
    await sendReservationMail(db(), 'cancelled', r).catch((e: unknown) => console.error('[seat-reservations/cancel] mail', e));
    return NextResponse.json({ ok: true, code: r.code });
  });
}
