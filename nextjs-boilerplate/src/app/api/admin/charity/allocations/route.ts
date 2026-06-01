/**
 * POST /api/admin/charity/allocations — promotér daruje tickety charitě
 *
 * Body: { charityId, eventId, ticketTypeId?, quantity (1..500), taxWriteOffValueHalire?, message? }
 *
 * Vytvoří allocation + N claim_slots s unique tokeny. Charity dashboard pak
 * vidí slots a distribuuje URLs beneficiaries.
 *
 * GET /api/admin/charity/allocations — list promoter's allocations s progress.
 *
 * CZ priority #9 (FR/UK/IT audit, Tickets for Good pattern).
 */
import { randomBytes } from 'crypto';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';


const createSchema = z.object({
  charityId: z.string().uuid(),
  eventId: z.string().uuid(),
  ticketTypeId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(500),
  taxWriteOffValueHalire: z.number().int().min(0).max(10_000_000_000).optional(),
  message: z.string().max(500).optional(),
});

function token(): string {
  return randomBytes(24)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    charity_id: string;
    charity_name: string;
    event_id: string;
    event_title: string;
    quantity: number;
    tax_write_off_value_halire: string;
    created_at: string;
    claimed_count: string;
  }>(
    `SELECT a.id, a.charity_id, c.name AS charity_name,
            a.event_id, e.title AS event_title,
            a.quantity, a.tax_write_off_value_halire::text, a.created_at,
            (SELECT COUNT(*)::text FROM charity.claim_slots s
              WHERE s.allocation_id = a.id AND s.status = 'claimed') AS claimed_count
       FROM charity.allocations a
       JOIN charity.partners c ON c.id = a.charity_id
       JOIN catalog.events e ON e.id = a.event_id
      WHERE a.promoter_id = $1
      ORDER BY a.created_at DESC
      LIMIT 100`,
    [promoter.promoterId],
  );
  return NextResponse.json({ allocations: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    // Ověř že charity je approved
    const ch = await client.query<{ id: string }>(
      `SELECT id FROM charity.partners WHERE id = $1 AND approved = true`,
      [input.charityId],
    );
    if (ch.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'CHARITY_NOT_APPROVED' }, { status: 422 });
    }

    // Ověř že event patří promoterovi
    const ev = await client.query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [input.eventId],
    );
    if (ev.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    }
    if (ev.rows[0].promoter_id !== promoter.promoterId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'WRONG_PROMOTER' }, { status: 403 });
    }

    const alloc = await client.query<{ id: string }>(
      `INSERT INTO charity.allocations
         (promoter_id, charity_id, event_id, ticket_type_id, quantity,
          tax_write_off_value_halire, message, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        promoter.promoterId,
        input.charityId,
        input.eventId,
        input.ticketTypeId ?? null,
        input.quantity,
        input.taxWriteOffValueHalire ?? 0,
        input.message ?? null,
        promoter.userId,
      ],
    );
    const allocationId = alloc.rows[0].id;

    // Vytvoř N claim slots — batch insert
    const slots: Array<{ allocation_id: string; claim_token: string }> = [];
    for (let i = 0; i < input.quantity; i++) {
      slots.push({ allocation_id: allocationId, claim_token: token() });
    }
    const values = slots
      .map((_s, i) => `($1, $${i + 2})`)
      .join(', ');
    await client.query(
      `INSERT INTO charity.claim_slots (allocation_id, claim_token) VALUES ${values}`,
      [allocationId, ...slots.map((s) => s.claim_token)],
    );

    await client.query('COMMIT');
    return NextResponse.json(
      {
        ok: true,
        allocationId,
        slotsCreated: input.quantity,
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/admin/charity/allocations]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
