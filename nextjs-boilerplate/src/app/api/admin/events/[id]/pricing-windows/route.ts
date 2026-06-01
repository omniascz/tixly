/**
 * GET/POST /api/admin/events/[id]/pricing-windows
 *
 * Time-based pricing windows pro všechny ticket_types eventu.
 * Eg. "Early bird do 30. 5. = -20%", "Late surge posledních 7 dní = +15%".
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  ticketTypeId: z.string().uuid(),
  name: z.string().min(2).max(200),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  priceOverride: z.number().int().min(0).max(100_000_000).optional(),
  priceChangePct: z.number().min(-90).max(500).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
}).refine((d) => d.priceOverride !== undefined || d.priceChangePct !== undefined, {
  message: 'priceOverride NEBO priceChangePct musí být zadán',
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (_promoter) => {
  const { id: eventId } = await params;

  const r = await db().query<{
    id: string;
    ticket_type_id: string;
    ticket_type_name: string;
    name: string;
    starts_at: string;
    ends_at: string;
    price_override: number | null;
    price_change_pct: number | null;
    priority: number;
    enabled: boolean;
  }>(
    `SELECT pw.id, pw.ticket_type_id, tt.name AS ticket_type_name,
            pw.name, pw.starts_at::text, pw.ends_at::text,
            pw.price_override, pw.price_change_pct, pw.priority, pw.enabled
       FROM catalog.pricing_windows pw
       JOIN catalog.ticket_types tt ON tt.id = pw.ticket_type_id
      WHERE tt.event_id = $1
   ORDER BY pw.priority DESC, pw.starts_at`,
    [eventId],
  );

  return NextResponse.json({ windows: r.rows });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }

  // Ownership: ticket_type patří k eventu promotéra
  const own = await db().query(
    `SELECT 1 FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = $1 AND e.id = $2 AND e.promoter_id = $3`,
    [parsed.data.ticketTypeId, eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.pricing_windows
       (ticket_type_id, name, starts_at, ends_at, price_override, price_change_pct, priority)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, COALESCE($7, 100))
     RETURNING id`,
    [
      parsed.data.ticketTypeId, parsed.data.name,
      parsed.data.startsAt, parsed.data.endsAt,
      parsed.data.priceOverride ?? null,
      parsed.data.priceChangePct ?? null,
      parsed.data.priority ?? null,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
