/**
 * POST /api/admin/events/[id]/holds/issue
 *
 * Z držených míst vydá vstupenky a pošle je e-mailem.
 *
 * Do srpna 2026 vedlo od drženého místa k vydané vstupence nic — držení sedadla
 * a vydání volné vstupenky byly dva nepropojené světy: vydat vstupenku šlo jen
 * na typ vstupenky, ne na konkrétní sedadlo, a e-mail se neposílal vůbec.
 * Tenhle endpoint obojí spojuje.
 *
 * Co se stane:
 *   1. Ověří se, že všechna zadaná místa opravdu drží pořadatel (ne kupující).
 *   2. Vznikne objednávka za nula korun s příznakem, komu a proč byla vydaná.
 *   3. Vstupenky se vydají **na ta konkrétní sedadla** a místa přejdou na prodaná.
 *   4. Odešle se e-mail s PDF a QR kódem — stejnou cestou jako běžná vstupenka.
 *
 * Když odeslání selže, vstupenky **zůstanou vydané** a vrátí se důvod. Opakované
 * odeslání pak řeší `/api/admin/orders/[orderId]/send-tickets` — jinak by se při
 * chybě e-mailu rušila platná vstupenka.
 */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { sendOrderTickets } from '@/lib/email/send-order-tickets';
import { createOrGetGuestUser } from '@/lib/identity/guest-user';
import { issueTicketsForOrder } from '@/lib/tickets/demo-issuer';

export const dynamic = 'force-dynamic';

const COMP_TYPES = ['press', 'vip', 'artist', 'sponsor', 'staff', 'other'] as const;

/** Kategorie držení → důvod vydání, aby to promotér nemusel vyplňovat dvakrát. */
const KIND_TO_COMP: Record<string, (typeof COMP_TYPES)[number]> = {
  artist: 'artist',
  promoter: 'vip',
  comp: 'other',
  production: 'staff',
};

const postSchema = z.object({
  seatIds: z.array(z.string().uuid()).min(1).max(50),
  recipientName: z.string().min(1).max(200),
  recipientEmail: z.string().email().max(320),
  compType: z.enum(COMP_TYPES).optional(),
  note: z.string().max(500).optional(),
  /** Vydat bez odeslání — vstupenky se pošlou později. */
  sendEmail: z.boolean().optional(),
});

interface SeatRow {
  id: string;
  ticket_type_id: string | null;
  status: string;
  hold_kind: string | null;
  hold_label: string | null;
  sector: string;
  row: string;
  seat_number: string;
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Uživatel příjemce se zakládá servisně, mimo transakci — stejně jako
    // u volných vstupenek. Pod promotérským kontextem upsert selže.
    const userId = await runWithServiceContext(() =>
      createOrGetGuestUser(db(), {
        email: input.recipientEmail,
        name: input.recipientName,
        onExisting: 'fillName',
      }),
    );

    let orderId: string | null = null;
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const seatsRes = await client.query<SeatRow>(
        `SELECT id, ticket_type_id, status, hold_kind, hold_label, sector, row, seat_number
         FROM catalog.event_seats
         WHERE event_id = $1 AND id = ANY($2::uuid[])
         FOR UPDATE`,
        [params.id, input.seatIds],
      );

      if (seatsRes.rows.length !== input.seatIds.length) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SEAT_NOT_FOUND', message: 'Některé místo k této akci nepatří.' },
          { status: 404 },
        );
      }

      // Vydávat lze jen z míst, která drží pořadatel. Prodané místo ani místo,
      // které má někdo v košíku, se nesmí přebrat.
      const notOurs = seatsRes.rows.filter(
        (s) =>
          !(
            (s.status === 'held' || s.status === 'blocked') &&
            s.hold_kind !== null &&
            s.hold_kind !== 'customer' &&
            s.hold_kind !== 'group_invite'
          ),
      );
      if (notOurs.length > 0) {
        await client.query('ROLLBACK');
        const s = notOurs[0];
        return NextResponse.json(
          {
            error: 'SEAT_NOT_HELD',
            message: `Místo ${s.sector} ${s.row}/${s.seat_number} nedržíš — je ${
              s.status === 'sold' ? 'prodané' : 'volné nebo ho má někdo v košíku'
            }. Nejdřív ho vezmi stranou.`,
          },
          { status: 409 },
        );
      }

      const typeIds = [...new Set(seatsRes.rows.map((s) => s.ticket_type_id))];
      if (typeIds.length !== 1 || typeIds[0] === null) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'MIXED_TICKET_TYPES',
            message:
              'Vybraná místa patří k různým typům vstupenek nebo nemají cenu. Vydávej je po skupinách.',
          },
          { status: 422 },
        );
      }
      const ticketTypeId = typeIds[0];

      // Měna je na akci, ne na typu vstupenky — `catalog.ticket_types` sloupec
      // `currency` nemá. Stejně to řeší vydávání volných vstupenek.
      const ttRes = await client.query<{ currency: string; remaining_qty: number | null }>(
        `SELECT e.currency, tt.remaining_qty
         FROM catalog.ticket_types tt
         JOIN catalog.events e ON e.id = tt.event_id
         WHERE tt.id = $1`,
        [ticketTypeId],
      );
      const tt = ttRes.rows[0];
      if (!tt) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'TICKET_TYPE_NOT_FOUND' }, { status: 404 });
      }

      const compType =
        input.compType ?? KIND_TO_COMP[seatsRes.rows[0].hold_kind ?? 'other'] ?? 'other';
      const qty = seatsRes.rows.length;
      orderId = randomUUID();

      // `expires_at` je NOT NULL i u zaplacené objednávky — stejně jako
      // u vydávání volných vstupenek se nastavuje týden dopředu.
      await client.query(
        `INSERT INTO orders.orders
           (id, user_id, event_id, status, total_amount, currency, locale,
            payment_provider, idempotency_key, discount_halire,
            requires_age_verification, paid_at, expires_at, comp_type, comp_notes,
            created_at, updated_at)
         VALUES ($1,$2,$3,'paid',0,$4,'cs','comp',$5,0,FALSE,NOW(),
                 NOW() + INTERVAL '7 days',$6,$7,NOW(),NOW())`,
        [
          orderId,
          userId,
          params.id,
          tt.currency,
          randomUUID(),
          compType,
          input.note ?? seatsRes.rows[0].hold_label ?? null,
        ],
      );

      await client.query(
        `INSERT INTO orders.order_items (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1,$2,$3,0,0)`,
        [orderId, ticketTypeId, qty],
      );

      // Držené místo se z kapacity odečetlo už při držení, takže se
      // `remaining_qty` znovu nesnižuje — jinak by se stejné místo odečetlo dvakrát.
      await client.query(
        `UPDATE catalog.event_seats
         SET status = 'sold', order_id = $2, hold_until = NULL, updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [input.seatIds, orderId],
      );

      const issued = await issueTicketsForOrder(orderId, client);

      // Přiřazení vstupenek ke konkrétním sedadlům — kvůli tomu to celé je.
      for (let i = 0; i < issued.length && i < seatsRes.rows.length; i++) {
        await client.query(`UPDATE tickets.tickets SET event_seat_id = $2 WHERE id = $1`, [
          issued[i].ticketId,
          seatsRes.rows[i].id,
        ]);
      }

      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('orders','orders',$1,'INSERT',$2,'user',$3::jsonb)`,
        [
          orderId,
          promoter.userId,
          JSON.stringify({
            kind: 'hold_issue_tickets',
            seat_count: qty,
            comp_type: compType,
            recipient: input.recipientEmail,
          }),
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[holds/issue]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }

    // Odeslání až po potvrzení transakce — kdyby selhalo, vstupenky zůstanou
    // platné a pošlou se znovu z detailu objednávky.
    if (input.sendEmail === false) {
      return NextResponse.json({
        ok: true,
        orderId,
        ticketCount: input.seatIds.length,
        emailSent: false,
        message: 'Vstupenky vydané. E-mail se neodesílal.',
      });
    }

    const mail = await runWithServiceContext(() =>
      sendOrderTickets(orderId, {
        toOverride: input.recipientEmail,
        note: input.note ?? 'Vstupenka pro vás od pořadatele.',
      }),
    );

    return NextResponse.json({
      ok: true,
      orderId,
      ticketCount: input.seatIds.length,
      emailSent: mail.sent,
      pdfAttached: mail.pdfAttached,
      message: mail.sent
        ? `Vstupenky vydané a odeslané na ${mail.to}.`
        : `Vstupenky vydané, ale e-mail neodešel: ${mail.reason ?? 'neznámý důvod'}. Pošli je znovu z detailu objednávky.`,
    });
  });
}
