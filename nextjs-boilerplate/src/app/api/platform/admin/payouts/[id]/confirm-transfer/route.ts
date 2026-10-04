/**
 * POST /api/platform/admin/payouts/[id]/confirm-transfer — platform admin potvrdí ruční převod výplaty.
 * Body: { transferDate: 'YYYY-MM-DD', bankReference: string }
 *
 * Kolo 7 (C-57): jediná cesta, jak ruční (CZK) výplatu dostat do `paid`. Bez data nebo reference 400,
 * už vyplacená 409. Změna stavu a záznam do audit.platform_log v jedné transakci.
 * Ne-admina zastaví middleware (403) i runAsPlatformAdmin (401).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

const CONFIRMABLE = ['awaiting_manual_transfer', 'processing', 'approved', 'pending'];

const schema = z.object({
  transferDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bankReference: z.string().trim().min(1).max(140),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'TRANSFER_CONFIRMATION_REQUIRED', message: 'Vyplňte datum převodu (YYYY-MM-DD) a referenci platby.', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { transferDate, bankReference } = parsed.data;
    const d = new Date(`${transferDate}T12:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== transferDate || d.getTime() > Date.now() + 86_400_000) {
      return NextResponse.json({ error: 'TRANSFER_DATE_INVALID', message: 'Datum převodu je neplatné nebo v budoucnosti.' }, { status: 400 });
    }

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      const result = await asSystemInTx(client, async () => {
        const cur = await client.query<{ status: string; promoter_id: string; net_payout: number; currency: string }>(
          `SELECT status, promoter_id, net_payout, currency FROM platform.payouts WHERE id = $1 FOR UPDATE`,
          [params.id],
        );
        const p = cur.rows[0];
        if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        if (!CONFIRMABLE.includes(p.status)) {
          return NextResponse.json(
            { error: 'PAYOUT_NOT_CONFIRMABLE', message: `Výplatu ve stavu ${p.status} nelze potvrdit.` },
            { status: 409 },
          );
        }
        await client.query(
          `UPDATE platform.payouts
              SET status = 'paid', transfer_date = $2::date, bank_reference = $3,
                  transfer_confirmed_by = $4, transfer_confirmed_at = NOW(),
                  paid_at = ($2::date + time '12:00') AT TIME ZONE 'Europe/Prague', failure_reason = NULL
            WHERE id = $1`,
          [params.id, transferDate, bankReference, admin.userId],
        );
        await client.query(
          `INSERT INTO audit.platform_log (actor_user_id, actor_role, promoter_id, action, target_type, target_id, metadata, ip, user_agent)
           VALUES ($1, 'platform_admin', $2, 'payout.transfer_confirmed', 'payout', $3, $4::jsonb, $5, $6)`,
          [
            admin.userId, p.promoter_id, params.id,
            JSON.stringify({ fromStatus: p.status, transferDate, bankReference, netPayout: p.net_payout, currency: p.currency }),
            req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
            req.headers.get('user-agent'),
          ],
        );
        return NextResponse.json({ ok: true, status: 'paid', transferDate, bankReference });
      });
      await client.query(result.status === 200 ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
}
