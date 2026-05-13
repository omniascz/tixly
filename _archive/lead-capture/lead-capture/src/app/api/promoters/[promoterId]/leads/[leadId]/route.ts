import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getLead,
  updateLead,
  deleteLead,
} from '../../../../../../services/lead.service.js';
import { getServiceDeps } from '../../../../../../lib/service-container.js';
import { LeadCaptureError } from '../../../../../../lib/lead-errors.js';

const updateSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'won', 'lost']).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  contactedAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .transform((v) => (v ? new Date(v) : v)),
});

function handleError(err: unknown) {
  if (err instanceof LeadCaptureError) {
    return NextResponse.json(
      { success: false, code: err.code, message: err.message },
      { status: err.statusCode },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, message: 'Neplatný vstup.' },
      { status: 400 },
    );
  }
  return NextResponse.json(
    { success: false, message: 'Interní chyba serveru.' },
    { status: 500 },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { promoterId: string; leadId: string } },
) {
  try {
    const deps = getServiceDeps();
    const lead = await getLead(params.leadId, params.promoterId, deps);
    return NextResponse.json({ lead });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { promoterId: string; leadId: string } },
) {
  try {
    const body = await req.json();
    const parsed = updateSchema.parse(body);
    const deps = getServiceDeps();
    const lead = await updateLead(
      params.leadId,
      params.promoterId,
      parsed as any,
      deps,
    );
    return NextResponse.json({ lead });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { promoterId: string; leadId: string } },
) {
  try {
    const deps = getServiceDeps();
    await deleteLead(params.leadId, params.promoterId, deps);
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleError(err);
  }
}
