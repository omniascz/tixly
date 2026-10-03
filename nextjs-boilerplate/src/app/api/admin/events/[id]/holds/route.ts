/**
 * GET    /api/admin/events/[id]/holds  — přehled držených a vyřazených míst + mapa sálu k výběru
 * POST   /api/admin/events/[id]/holds  — hromadné držení nebo vyřazení míst
 * DELETE /api/admin/events/[id]/holds  — hromadné uvolnění zpět do prodeje
 *
 * Rozdíl mezi držením a vyřazením (2026-08):
 *   • **hold** (artist / promoter / comp) → `status='held'`, volitelně `hold_until`.
 *     Místo je dočasně stranou a čeká se, jestli ho někdo využije. Když ne,
 *     pustí se do prodeje.
 *   • **kill** (production) → `status='blocked'`. Místo se neprodává, protože
 *     na něm fyzicky nejde sedět — stojí tam zvuk, kamera nebo je zakrytý výhled.
 *     Nemá datum uvolnění; ruší se ručně, až technika zmizí.
 *   Do 2026-08 zapisovaly obě varianty `status='held'`, takže vyřazená místa
 *   vypadala jako dočasná rezervace a promotér neviděl skutečnou kapacitu.
 *
 * Výběr míst: buď `seatIds` (z plánku), nebo `selector` — sektor, řada
 * a rozsah čísel. Předtím se musela ID vypisovat ručně jako UUID, což se
 * u dvaceti míst pro produkci nedalo použít.
 *
 * Ownership: promotér musí vlastnit akci. Aktivní zákaznický hold se nepřebírá,
 * dokud nevyprší — jinak by kupujícímu zmizelo sedadlo uprostřed placení.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import { inSeatRange } from '@/lib/seating/seat-range';

/** Kategorie, které smí zakládat promotér. 'customer' patří checkoutu. */
const HOLD_KINDS = ['artist', 'promoter', 'comp', 'production'] as const;
type HoldKind = (typeof HOLD_KINDS)[number];

/** Vyřazení místa z prodeje — na rozdíl od držení nemá datum uvolnění. */
function isKill(kind: HoldKind): boolean {
  return kind === 'production';
}

const selectorSchema = z.object({
  sector: z.string().min(1).max(100),
  row: z.string().min(1).max(50).optional(),
  /** Rozsah čísel sedadel včetně krajů; u číselných řad se porovnává číselně. */
  from: z.string().min(1).max(20).optional(),
  to: z.string().min(1).max(20).optional(),
});

const postSchema = z
  .object({
    seatIds: z.array(z.string().uuid()).max(1000).optional(),
    selector: selectorSchema.optional(),
    kind: z.enum(HOLD_KINDS),
    label: z.string().max(120).optional(),
    releaseAt: z.string().datetime().optional(),
  })
  .refine((d) => Boolean(d.seatIds?.length) || Boolean(d.selector), {
    message: 'Vyber sedadla z plánku (seatIds) nebo zadej sektor a řadu (selector).',
  });

const deleteSchema = z
  .object({
    seatIds: z.array(z.string().uuid()).max(1000).optional(),
    kind: z.enum(HOLD_KINDS).optional(),
  })
  .refine((d) => Boolean(d.seatIds?.length) || Boolean(d.kind), {
    message: 'Zadej seatIds nebo kind.',
  });

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events
     WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{
      id: string;
      sector: string;
      row: string;
      seat_number: string;
      status: string;
      hold_kind: string;
      hold_label: string | null;
      hold_until: string | null;
    }>(
      `SELECT id, sector, row, seat_number, status, hold_kind, hold_label, hold_until
       FROM catalog.event_seats
       WHERE event_id = $1
         AND hold_kind IS NOT NULL
         AND hold_kind NOT IN ('customer', 'group_invite')
       ORDER BY hold_kind, sector, row, seat_number`,
      [params.id],
    );

    // Mapa sálu pro výběr — kolik je v které řadě volných míst, ať promotér
    // nemusí hádat, do čeho sahá.
    const map = await db().query<{
      sector: string;
      row: string;
      available: string;
      held: string;
      sold: string;
      blocked: string;
      min_num: string;
      max_num: string;
    }>(
      `SELECT sector, row,
              COUNT(*) FILTER (WHERE status = 'available')::text AS available,
              COUNT(*) FILTER (WHERE status = 'held')::text      AS held,
              COUNT(*) FILTER (WHERE status = 'sold')::text      AS sold,
              COUNT(*) FILTER (WHERE status = 'blocked')::text   AS blocked,
              MIN(seat_number) AS min_num,
              MAX(seat_number) AS max_num
       FROM catalog.event_seats
       WHERE event_id = $1
       GROUP BY sector, row
       ORDER BY sector, row`,
      [params.id],
    );

    const counts: Record<string, number> = {};
    for (const row of r.rows) {
      counts[row.hold_kind] = (counts[row.hold_kind] ?? 0) + 1;
    }

    const sectors = new Map<string, { name: string; rows: unknown[] }>();
    for (const m of map.rows) {
      const sec = sectors.get(m.sector) ?? { name: m.sector, rows: [] };
      sec.rows.push({
        label: m.row,
        available: Number(m.available),
        held: Number(m.held),
        sold: Number(m.sold),
        blocked: Number(m.blocked),
        firstSeat: m.min_num,
        lastSeat: m.max_num,
      });
      sectors.set(m.sector, sec);
    }

    return NextResponse.json({
      eventId: params.id,
      totalsByKind: counts,
      holds: r.rows.map((s) => ({
        seatId: s.id,
        sector: s.sector,
        row: s.row,
        seatNumber: s.seat_number,
        kind: s.hold_kind,
        // Vyřazené místo je 'blocked', držené 'held' — UI je má rozlišit.
        blocked: s.status === 'blocked',
        label: s.hold_label,
        releaseAt: s.hold_until,
      })),
      sectors: Array.from(sectors.values()),
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'BAD_INPUT', issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const { kind, selector } = parsed.data;
    const kill = isKill(kind);

    const client = await db().connect();
    try {
      await client.query('BEGIN');

      // 1) Sestavíme seznam sedadel — buď z ID, nebo ze selektoru.
      let seatIds: string[] = parsed.data.seatIds ?? [];
      if (selector) {
        const sel = await client.query<{ id: string; seat_number: string }>(
          `SELECT id, seat_number FROM catalog.event_seats
           WHERE event_id = $1 AND sector = $2
             AND ($3::text IS NULL OR row = $3)`,
          [params.id, selector.sector, selector.row ?? null],
        );
        const matched = sel.rows
          .filter((s) => inSeatRange(s.seat_number, selector.from, selector.to))
          .map((s) => s.id);
        seatIds = [...new Set([...seatIds, ...matched])];
      }

      if (seatIds.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NO_SEATS_MATCHED',
            message: 'Zadanému výběru neodpovídá žádné sedadlo. Zkontroluj název sektoru a řady.',
          },
          { status: 422 },
        );
      }
      if (seatIds.length > 1000) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'TOO_MANY_SEATS', message: 'Najednou lze zpracovat nejvýš 1000 míst.' },
          { status: 422 },
        );
      }

      // 2) Zápis. Prodané místo se nedotkne nikdy; aktivní zákaznický hold
      //    taky ne — teprve až vyprší.
      const upd = await client.query<{ id: string }>(
        `UPDATE catalog.event_seats
         SET status     = $6,
             hold_kind  = $3,
             hold_label = $4,
             hold_until = $5,
             updated_at = NOW()
         WHERE event_id = $1
           AND id = ANY($2::uuid[])
           AND status IN ('available', 'held', 'blocked')
           AND (
             hold_kind IS NULL
             OR hold_kind IN ('artist', 'promoter', 'comp', 'production')
             OR (hold_until IS NOT NULL AND hold_until < NOW())
           )
         RETURNING id`,
        [
          params.id,
          seatIds,
          kind,
          parsed.data.label ?? null,
          // Vyřazené místo se samo neuvolní — technika nezmizí podle kalendáře.
          kill ? null : (parsed.data.releaseAt ?? null),
          kill ? 'blocked' : 'held',
        ],
      );

      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('catalog', 'event_seats', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
        [
          params.id,
          promoter.userId,
          JSON.stringify({
            kind: kill ? 'seat_kill_create' : 'seat_hold_create',
            hold_kind: kind,
            label: parsed.data.label ?? null,
            release_at: kill ? null : (parsed.data.releaseAt ?? null),
            selector: selector ?? null,
            seat_count: upd.rows.length,
            requested: seatIds.length,
          }),
        ],
      );

      await client.query('COMMIT');
      const skipped = seatIds.length - upd.rows.length;
      return NextResponse.json({
        ok: true,
        held: upd.rows.length,
        requested: seatIds.length,
        skipped,
        blocked: kill,
        message:
          skipped > 0
            ? `${upd.rows.length} míst ${kill ? 'vyřazeno' : 'drženo'}, ${skipped} přeskočeno — jsou prodaná nebo je právě kupuje někdo jiný.`
            : `${upd.rows.length} míst ${kill ? 'vyřazeno z prodeje' : 'drženo'}.`,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[POST holds]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'BAD_INPUT', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const args: unknown[] = [params.id];
    let whereExtra = '';
    if (parsed.data.seatIds && parsed.data.seatIds.length > 0) {
      args.push(parsed.data.seatIds);
      whereExtra += ` AND id = ANY($${args.length}::uuid[])`;
    }
    if (parsed.data.kind) {
      args.push(parsed.data.kind);
      whereExtra += ` AND hold_kind = $${args.length}`;
    } else {
      whereExtra += ` AND hold_kind IS NOT NULL AND hold_kind NOT IN ('customer', 'group_invite')`;
    }

    // Uvolňujeme jen to, co drží promotér. Prodané místo zůstává prodané.
    const r = await db().query<{ id: string }>(
      `UPDATE catalog.event_seats
       SET status = 'available',
           hold_kind = NULL,
           hold_label = NULL,
           hold_until = NULL,
           updated_at = NOW()
       WHERE event_id = $1
         AND status IN ('held', 'blocked')
         ${whereExtra}
       RETURNING id`,
      args,
    );

    await db().query(
      `INSERT INTO audit.audit_log
         (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
       VALUES ('catalog', 'event_seats', $1, 'UPDATE', $2, 'user', $3::jsonb)`,
      [
        params.id,
        promoter.userId,
        JSON.stringify({
          kind: 'seat_hold_release',
          hold_kind: parsed.data.kind ?? null,
          seat_count: r.rows.length,
        }),
      ],
    );

    return NextResponse.json({
      ok: true,
      released: r.rows.length,
      message: `${r.rows.length} míst vráceno do prodeje.`,
    });
  });
}
