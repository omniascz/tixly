/**
 * DELETE /api/buyer/subscriptions/[id]/pick/[eventId] — Restwert cancel-pick
 *
 * Buyer zruší jeden vybraný event z Wahl-Abo. Důsledky:
 *   1) tickets.tickets.status = 'revoked'
 *   2) subscriptions.redemptions záznam smazán (uvolní pick slot — buyer
 *      si může vybrat jiný event místo něj DOKUD package.sale_end neuplynul)
 *   3) holders.restwert_credit_halire += per_pick_value
 *      kde per_pick_value = price_paid_halire / max_picks_for_choice
 *
 * Validace:
 *   - holder.user_id === header x-user-id
 *   - abo_type === 'choice'
 *   - redemption existuje pro (holder_id, event_id)
 *   - event.date_start > NOW() (nelze zrušit ticket na již proběhlou akci)
 *
 * DACH parity #P0-2 dotažení (Reservix Restwert pattern).
 */
import { NextRequest, NextResponse } from 'next/server';
import { asSystemInTx, db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';


export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; eventId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: vlastnictví abonentky ověřeno níže pod kontextem kupce; zbytek jsou systémové příkazy (asSystemInTx).

    // Kolo 3: vlastnictví abonentky pod kontextem kupce (RLS: holders.user_id = kupec).
    const ownRes = await client.query(
      `SELECT 1 FROM subscriptions.holders WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [params.id, userId],
    );
    if (ownRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // Load holder + package + redemption
    const holderRes = await asSystemInTx(client, () => client.query<{
      id: string;
      user_id: string | null;
      package_id: string;
      abo_type: string;
      max_picks_for_choice: number | null;
      price_paid_halire: number;
      restwert_credit_halire: number;
    }>(
      `SELECT h.id, h.user_id, h.package_id, p.abo_type, p.max_picks_for_choice,
              h.price_paid_halire, h.restwert_credit_halire
         FROM subscriptions.holders h
         JOIN subscriptions.packages p ON p.id = h.package_id
        WHERE h.id = $1
        FOR UPDATE OF h`,
      [params.id],
    ));
    if (holderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const holder = holderRes.rows[0];
    if (holder.user_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }
    if (holder.abo_type !== 'choice') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_CHOICE_ABO', message: 'Restwert je dostupný jen pro Wahl-Abo.' },
        { status: 409 },
      );
    }

    // Find redemption + event date
    const redRes = await asSystemInTx(client, () => client.query<{
      ticket_id: string | null;
      event_date_start: string;
    }>(
      `SELECT r.ticket_id, e.date_start::text AS event_date_start
         FROM subscriptions.redemptions r
         JOIN catalog.events e ON e.id = r.event_id
        WHERE r.holder_id = $1 AND r.event_id = $2`,
      [holder.id, params.eventId],
    ));
    if (redRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'NOT_PICKED', message: 'Tento event nemáš ve výběru.' },
        { status: 404 },
      );
    }
    const red = redRes.rows[0];
    if (new Date(red.event_date_start).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'EVENT_ALREADY_STARTED', message: 'Nelze zrušit výběr, akce už začala.' },
        { status: 409 },
      );
    }

    // Revoke ticket (pokud existuje), smaž redemption, navýš credit
    if (red.ticket_id) {
      await asSystemInTx(client, () => client.query(
        `UPDATE tickets.tickets
            SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [red.ticket_id],
      ));
    }
    await asSystemInTx(client, () => client.query(
      `DELETE FROM subscriptions.redemptions
        WHERE holder_id = $1 AND event_id = $2`,
      [holder.id, params.eventId],
    ));

    // Restwert credit = per-pick proportional value
    const maxPicks = holder.max_picks_for_choice ?? 1;
    const perPickValue = Math.floor(holder.price_paid_halire / maxPicks);
    const newCredit = holder.restwert_credit_halire + perPickValue;
    await asSystemInTx(client, () => client.query(
      `UPDATE subscriptions.holders
          SET restwert_credit_halire = $2
        WHERE id = $1`,
      [holder.id, newCredit],
    ));

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      cancelledEventId: params.eventId,
      restwertCreditHalire: newCredit,
      perPickValueHalire: perPickValue,
      message: `Výběr zrušen. Kredit +${perPickValue / 100} Kč.`,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[DELETE /api/buyer/subscriptions/.../pick/eventId]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
