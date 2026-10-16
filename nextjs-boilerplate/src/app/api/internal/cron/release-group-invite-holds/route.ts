/**
 * POST /api/internal/cron/release-group-invite-holds
 * Uvolní nezaplacená sedadla z AXS Invite:
 *  1) nclaimnutá držená sedadla po 48 h (hold_kind='group_invite', hold_until < now)
 *  2) claimnutá ale nezaplacená (order pending + expired) → sedadlo zpět available,
 *     order cancelled, seats_claimed--.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isInternalTokenAuthorized } from '@/lib/security/cron-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function POST(req: NextRequest): Promise<Response> {
  // Kolo 3 (K3a kontrola cron rout): dřív se při chybějícím env token neporovnával → bez
  // INTERNAL_SERVICE_TOKEN v env prošel jakýkoli token. Fail-closed sdíleným helperem.
  if (!isInternalTokenAuthorized(req)) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  // Cron bezi bez uzivatele — bez kontextu by RLS odfiltrovalo vse.
  // POZOR: pod servisnim kontextem si musi routa filtrovat sama.
  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Kolo 3: servisní kontext (runWithServiceContext) stačí — politiky mají větev app_is_service(); admin eskalace odstraněna.

      // 1) Expirované nezaclaimnuté hold sedadla → available
      const releasedHolds = await client.query(
        `UPDATE catalog.event_seats
            SET status = 'available', hold_kind = NULL, hold_until = NULL,
                hold_user_id = NULL, updated_at = NOW()
          WHERE hold_kind = 'group_invite' AND status = 'held' AND hold_until < NOW()`,
      );

      // 2) Claimnuté ale nezaplacené objednávky (group invite) → uvolni sedadlo, zruš order
      const staleOrders = await client.query<{ id: string; group_invitation_id: string }>(
        `SELECT id, group_invitation_id FROM orders.orders
          WHERE group_invitation_id IS NOT NULL AND status = 'pending'
            AND expires_at < NOW()`,
      );
      let releasedClaims = 0;
      for (const o of staleOrders.rows) {
        await client.query(
          `UPDATE catalog.event_seats
              SET status = 'available', order_id = NULL, updated_at = NOW()
            WHERE order_id = $1 AND status = 'sold'`,
          [o.id],
        );
        await client.query(
          `UPDATE orders.orders SET status = 'expired', updated_at = NOW() WHERE id = $1`,
          [o.id],
        );
        await client.query(
          `UPDATE orders.group_invitations
              SET seats_claimed = GREATEST(0, seats_claimed - 1)
            WHERE id = $1`,
          [o.group_invitation_id],
        );
        releasedClaims++;
      }

      // 3) Označ invitace s prošlým holdem jako expired
      await client.query(
        `UPDATE orders.group_invitations
            SET status = 'expired'
          WHERE adjacent_reserve = true AND status = 'open'
            AND hold_expires_at < NOW()`,
      );

      await client.query('COMMIT');
      return NextResponse.json({
        ok: true,
        releasedHoldSeats: releasedHolds.rowCount ?? 0,
        releasedUnpaidClaims: releasedClaims,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[release-group-invite-holds]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
