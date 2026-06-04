/**
 * POST /api/admin/scanner/validate-group
 *
 * JEDEN QR odbaví celou objednávku. Lead osoba ukáže group QR, scanner:
 *   - PREVIEW (jen orderToken): vrátí všechny lístky objednávky + statusy
 *     („10 lístků, 9 volných, 1 použitý") → obsluha vidí skupinu.
 *   - ADMIT: { admitAll } pustí všechny volné, nebo { admitTicketIds } jen
 *     vybrané (např. 9 z 10 — jeden přijde později → pustí se dalším skenem).
 *
 * Bezpečnost: orderToken = HMAC podpis + 60s TTL (anti-screenshot). Promotér
 * ownership přes events.promoter_id. Idempotentní (už použitý lístek se přeskočí).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { verifyGroupToken } from '@/lib/safetix/group-token';

const schema = z.object({
  orderToken: z.string().min(20).max(2048),
  admitAll: z.boolean().optional(),
  admitTicketIds: z.array(z.string().regex(/^[0-9a-f-]{36}$/i)).max(100).optional(),
});

interface TicketRow {
  id: string;
  status: string;
  type_name: string | null;
  seat_label: string | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const body: unknown = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

    const v = verifyGroupToken(parsed.data.orderToken);
    if (!v.ok || !v.payload) {
      return NextResponse.json(
        { result: v.reason === 'expired' ? 'expired' : 'invalid', message:
            v.reason === 'expired'
              ? 'Group QR vypršel — host musí obnovit kód v appce.'
              : 'Neplatný group QR.' },
        { status: 200 },
      );
    }
    const orderId = v.payload.orderId;

    const load = async (): Promise<TicketRow[]> =>
      (await db().query<TicketRow>(
        `SELECT t.id, t.status, tt.name AS type_name,
                CASE WHEN es.id IS NOT NULL
                     THEN concat_ws(' ', es.sector, es.row, es.seat_number) END AS seat_label
           FROM tickets.tickets t
           JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
           JOIN catalog.events e ON e.id = tt.event_id
           LEFT JOIN catalog.event_seats es ON es.id = t.event_seat_id
          WHERE t.order_id = $1 AND e.promoter_id = $2
          ORDER BY tt.name, seat_label, t.id`,
        [orderId, promoter.promoterId],
      )).rows;

    let tickets = await load();
    if (tickets.length === 0) {
      return NextResponse.json(
        { result: 'not_found', message: 'Objednávka neexistuje nebo nepatří k vaší akci.' },
        { status: 200 },
      );
    }

    // ── ADMIT (volitelné) ──────────────────────────────────────────────────
    let admittedIds: string[] = [];
    const wantAdmit = parsed.data.admitAll || (parsed.data.admitTicketIds?.length ?? 0) > 0;
    if (wantAdmit) {
      const args: unknown[] = [orderId, promoter.promoterId];
      let idFilter = '';
      if (!parsed.data.admitAll && parsed.data.admitTicketIds) {
        args.push(parsed.data.admitTicketIds);
        idFilter = `AND t.id = ANY($3::uuid[])`;
      }
      const upd = await db().query<{ id: string }>(
        `UPDATE tickets.tickets t
            SET status = 'used', used_at = NOW(), updated_at = NOW()
           FROM catalog.ticket_types tt, catalog.events e
          WHERE t.ticket_type_id = tt.id AND tt.event_id = e.id
            AND t.order_id = $1 AND e.promoter_id = $2
            AND t.status = 'valid' ${idFilter}
        RETURNING t.id`,
        args,
      );
      admittedIds = upd.rows.map((r) => r.id);
      tickets = await load(); // čerstvé statusy po admitu
    }

    const counts = {
      total: tickets.length,
      valid: tickets.filter((t) => t.status === 'valid').length,
      used: tickets.filter((t) => t.status === 'used').length,
      other: tickets.filter((t) => !['valid', 'used'].includes(t.status)).length,
    };

    return NextResponse.json({
      result: 'ok',
      orderId,
      eventTitle: undefined,
      counts,
      admittedCount: admittedIds.length,
      admittedIds,
      tickets: tickets.map((t) => ({
        id: t.id,
        label: [t.type_name, t.seat_label].filter(Boolean).join(' · ') || 'Vstupenka',
        status: t.status,
      })),
    });
  });
}
