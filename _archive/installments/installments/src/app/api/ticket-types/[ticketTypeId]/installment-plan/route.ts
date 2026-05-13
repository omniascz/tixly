// GET  /api/ticket-types/[ticketTypeId]/installment-plan — read plan config
// PUT  /api/ticket-types/[ticketTypeId]/installment-plan — create / update plan (organizer)

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toInstallmentHttpError, InstallmentPlanNotFoundError } from '../../../../../types/installment.types';
import type { InstallmentPlan } from '../../../../../types/installment.types';

// ---------------------------------------------------------------------------
// Zod schema for PUT body
// ---------------------------------------------------------------------------

const PutInstallmentPlanSchema = z.object({
  num_installments: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  interval: z.enum(['weekly', 'monthly']),
  /**
   * Percentage of total price for the first installment.
   * Must be between 1 and 99.
   * Defaults applied server-side when omitted: 50 → 2, 34 → 3, 25 → 4.
   */
  first_installment_pct: z.number().int().min(1).max(99).optional(),
  active: z.boolean().optional().default(true),
});

type PutInstallmentPlanInput = z.infer<typeof PutInstallmentPlanSchema>;

// ---------------------------------------------------------------------------
// Default first_installment_pct by num_installments
// ---------------------------------------------------------------------------

const DEFAULT_FIRST_PCT: Record<2 | 3 | 4, number> = {
  2: 50,
  3: 34,
  4: 25,
};

// ---------------------------------------------------------------------------
// DB adapter interface (minimal — only what these routes need)
// ---------------------------------------------------------------------------

interface PlanDbAdapter {
  findInstallmentPlan(ticketTypeId: string): Promise<InstallmentPlan | null>;
  upsertInstallmentPlan(ticketTypeId: string, data: Omit<InstallmentPlan, 'id'>): Promise<InstallmentPlan>;
  isOrganizer(userId: string, ticketTypeId: string): Promise<boolean>;
}

function getPlanDbAdapter(): PlanDbAdapter {
  // Production: return new PostgresPlanAdapter(pool);
  throw new Error('PlanDbAdapter not configured. Wire a real DB adapter here.');
}

// ---------------------------------------------------------------------------
// GET /api/ticket-types/[ticketTypeId]/installment-plan
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: { ticketTypeId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const db = getPlanDbAdapter();
    const plan = await db.findInstallmentPlan(params.ticketTypeId);

    if (!plan) {
      throw new InstallmentPlanNotFoundError(
        `No installment plan configured for ticket type ${params.ticketTypeId}.`,
      );
    }

    return NextResponse.json(plan, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof InstallmentPlanNotFoundError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
    }
    const { status, body } = toInstallmentHttpError(err);
    return NextResponse.json(body, { status });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/ticket-types/[ticketTypeId]/installment-plan
// ---------------------------------------------------------------------------

export async function PUT(
  request: NextRequest,
  { params }: { params: { ticketTypeId: string } },
): Promise<NextResponse> {
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  // Parse and validate request body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
      { status: 400 },
    );
  }

  const parsed = PutInstallmentPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 422 },
    );
  }

  const input: PutInstallmentPlanInput = parsed.data;

  try {
    const db = getPlanDbAdapter();

    // Verify organizer role for this ticket type.
    const authorized = await db.isOrganizer(userId, params.ticketTypeId);
    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const firstPct =
      input.first_installment_pct ?? DEFAULT_FIRST_PCT[input.num_installments];

    const plan = await db.upsertInstallmentPlan(params.ticketTypeId, {
      ticket_type_id: params.ticketTypeId,
      num_installments: input.num_installments,
      interval: input.interval,
      first_installment_pct: firstPct,
      active: input.active,
    });

    return NextResponse.json(plan, { status: 200 });
  } catch (err) {
    const { status, body } = toInstallmentHttpError(err);
    return NextResponse.json(body, { status });
  }
}
