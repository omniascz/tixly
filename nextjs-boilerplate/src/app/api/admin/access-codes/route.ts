/**
 * GET  /api/admin/access-codes?eventId=...  — kódy promotéra (volitelně per event)
 * POST /api/admin/access-codes              — vytvoří kód s vazbou na ticket types
 *
 * Předprodejní okno: promotér vytvoří kód „CLENOVE2026", váže ho na vybrané
 * ticket_types (`visibility = 'access_code'`). Buyer s kódem pak v event page
 * tyto skryté ticket_types odemkne přes `/api/events/[id]/unlock-access-code`.
 *
 * Auth: requirePromoter — kódy vidí pouze vlastník akce (events.promoter_id).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const createSchema = z.object({
  eventId: z.string().uuid(),
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i, 'kód: A–Z, 0–9, _, -'),
  label: z.string().max(100).optional(),
  maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  ticketTypeIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get('eventId');
  const args: unknown[] = [promoter.promoterId];
  let where = `ac.promoter_id = $1`;
  if (eventId) {
    args.push(eventId);
    where += ` AND ac.event_id = $${args.length}`;
  }

  const r = await db().query<{
    id: string;
    event_id: string;
    code: string;
    label: string | null;
    max_uses: number | null;
    uses_count: number;
    valid_from: string | null;
    valid_until: string | null;
    created_at: string;
    event_title: string;
    ticket_type_ids: string[] | null;
    ticket_type_names: string[] | null;
  }>(
    `SELECT ac.id, ac.event_id, ac.code, ac.label, ac.max_uses, ac.uses_count,
            ac.valid_from, ac.valid_until, ac.created_at,
            e.title AS event_title,
            (SELECT array_agg(actt.ticket_type_id)
               FROM catalog.access_code_ticket_types actt
               WHERE actt.access_code_id = ac.id) AS ticket_type_ids,
            (SELECT array_agg(tt.name)
               FROM catalog.access_code_ticket_types actt
               JOIN catalog.ticket_types tt ON tt.id = actt.ticket_type_id
               WHERE actt.access_code_id = ac.id) AS ticket_type_names
     FROM catalog.access_codes ac
     JOIN catalog.events e ON e.id = ac.event_id
     WHERE ${where}
     ORDER BY ac.created_at DESC
     LIMIT 200`,
    args,
  );

  return NextResponse.json({
    codes: r.rows.map((row) => ({
      id: row.id,
      eventId: row.event_id,
      eventTitle: row.event_title,
      code: row.code,
      label: row.label,
      maxUses: row.max_uses,
      usesCount: row.uses_count,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      createdAt: row.created_at,
      ticketTypeIds: row.ticket_type_ids ?? [],
      ticketTypeNames: row.ticket_type_names ?? [],
    })),
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    // 1) Event musí patřit promotérovi
    const evRes = await client.query<{ promoter_id: string | null }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [input.eventId],
    );
    const ev = evRes.rows[0];
    if (!ev || ev.promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EVENT_FORBIDDEN' }, { status: 403 });
    }

    // 2) Vlastní ticket types tohoto eventu
    const ttRes = await client.query<{ id: string }>(
      `SELECT id FROM catalog.ticket_types WHERE event_id = $1 AND id = ANY($2::uuid[])`,
      [input.eventId, input.ticketTypeIds],
    );
    if (ttRes.rows.length !== input.ticketTypeIds.length) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'INVALID_TICKET_TYPE', message: 'Některý ticket type nepatří k tomuto eventu.' },
        { status: 422 },
      );
    }

    // 3) Vytvoř access_code
    const codeRes = await client.query<{ id: string }>(
      `INSERT INTO catalog.access_codes
         (event_id, promoter_id, code, label, max_uses, valid_from, valid_until)
       VALUES ($1, $2, UPPER($3), $4, $5, $6, $7)
       RETURNING id`,
      [
        input.eventId,
        promoter.promoterId,
        input.code,
        input.label ?? null,
        input.maxUses ?? null,
        input.validFrom ?? null,
        input.validUntil ?? null,
      ],
    );
    const accessCodeId = codeRes.rows[0].id;

    // 4) Vazba na ticket types
    for (const ttId of input.ticketTypeIds) {
      await client.query(
        `INSERT INTO catalog.access_code_ticket_types (access_code_id, ticket_type_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [accessCodeId, ttId],
      );
    }

    // 5) Nastavit visibility ticket types na 'access_code'
    // (pokud jsou jen vázány na tento jeden code; jinak ponecháme)
    await client.query(
      `UPDATE catalog.ticket_types
         SET visibility = 'access_code'
       WHERE id = ANY($1::uuid[]) AND visibility = 'public'`,
      [input.ticketTypeIds],
    );

    await client.query('COMMIT');
    return NextResponse.json({ id: accessCodeId, success: true }, { status: 201 });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e instanceof Error && e.message.includes('access_codes_event_id_code_key')) {
      return NextResponse.json(
        { error: 'CODE_EXISTS', message: 'Tento kód pro tuto akci už existuje.' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
