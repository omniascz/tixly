/**
 * POST /api/internal/cron/seat-reservations (kolo 8 / krok 5)
 *
 * Rezervace s platbou na pokladně:
 *   - 24 h před koncem lhůty pošle kupci připomínku (jednou — reminded_at);
 *   - propadlé rezervace uvolní místa a kapacitu (release-capacity) a kupci pošle e-mail.
 * Spouštět každých 15 minut přes dispatcher (vercel.json). Ověření: x-internal-token.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { verifyInternalToken } from '@/lib/internal-auth';
import { claimDueReminders, expireDueReservations, sendReservationMail } from '@/lib/theatre/reservations';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyInternalToken(req.headers.get('x-internal-token'));
  if (!auth.ok) {
    console.error('[seat-reservations] odmítnuto:', auth.reason);
    return NextResponse.json({ error: 'Forbidden', reason: auth.reason }, { status: 403 });
  }
  return runWithServiceContext(async () => {
    const client = await db().connect();
    let expired: Awaited<ReturnType<typeof expireDueReservations>> = [];
    let reminders: Awaited<ReturnType<typeof claimDueReminders>> = [];
    try {
      await client.query('BEGIN');
      expired = await expireDueReservations(client);
      reminders = await claimDueReminders(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[seat-reservations]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
    let mailed = 0;
    for (const [kind, rows] of [['expired', expired], ['reminder', reminders]] as const) {
      for (const r of rows) {
        try {
          await sendReservationMail(db(), kind, r);
          mailed++;
        } catch (e) {
          console.error('[seat-reservations] mail', kind, r.code, e);
        }
      }
    }
    return NextResponse.json({ ok: true, expired: expired.length, reminded: reminders.length, mailed });
  });
}
