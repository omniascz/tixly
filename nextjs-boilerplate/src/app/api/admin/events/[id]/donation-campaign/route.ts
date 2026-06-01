/**
 * GET/POST/PATCH /api/admin/events/[id]/donation-campaign
 *
 * Donation campaign management. Pokud event má ticket_type s is_donation=true,
 * promotér tady spravuje goal, min/max amounts, beneficiary info.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const upsertSchema = z.object({
  ticketTypeId: z.string().uuid(),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  goalHalire: z.number().int().min(0).nullable().optional(),
  minAmountHalire: z.number().int().min(100).default(100),
  maxAmountHalire: z.number().int().min(100).nullable().optional(),
  beneficiaryOrgName: z.string().max(200).optional(),
  beneficiaryBankIban: z.string().max(40).optional(),
  beneficiaryUrl: z.string().url().optional(),
  thankYouMessage: z.string().max(1000).optional(),
  coverImageUrl: z.string().url().optional(),
  isActive: z.boolean().default(true),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const { id: eventId } = await params;

  const r = await db().query(
    `SELECT dc.*
       FROM catalog.donation_campaigns dc
       JOIN catalog.events e ON e.id = dc.event_id
      WHERE dc.event_id = $1 AND e.promoter_id = $2`,
    [eventId, promoter.promoterId],
  );

  return NextResponse.json({ campaigns: r.rows });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  }
  const d = parsed.data;

  // Ownership + is_donation flag setup
  const own = await db().query(
    `SELECT 1 FROM catalog.ticket_types tt
       JOIN catalog.events e ON e.id = tt.event_id
      WHERE tt.id = $1 AND e.id = $2 AND e.promoter_id = $3`,
    [d.ticketTypeId, eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });

  // Set ticket_type.is_donation = true
  await db().query(
    `UPDATE catalog.ticket_types SET is_donation = true WHERE id = $1`,
    [d.ticketTypeId],
  );

  const r = await db().query<{ id: string }>(
    `INSERT INTO catalog.donation_campaigns
       (event_id, promoter_id, ticket_type_id, name, description, goal_hellers,
        min_amount_hellers, max_amount_hellers, beneficiary_org_name,
        beneficiary_bank_iban, beneficiary_url, thank_you_message, cover_image_url, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      eventId, promoter.promoterId, d.ticketTypeId, d.name, d.description ?? null,
      d.goalHalire ?? null, d.minAmountHalire, d.maxAmountHalire ?? null,
      d.beneficiaryOrgName ?? null, d.beneficiaryBankIban ?? null,
      d.beneficiaryUrl ?? null, d.thankYouMessage ?? null, d.coverImageUrl ?? null,
      d.isActive,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
