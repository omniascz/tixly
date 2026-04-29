/**
 * Credit notes API routes for promoters.
 *
 * GET  /promoters/:promoterId/credit-notes — list credit notes
 * POST /promoters/:promoterId/credit-notes — create credit note (admin only)
 */
import { getServices } from '../../../../lib/service-container.js';
import {
  listCreditNotes,
  createCreditNote,
} from '../../../../services/credit-note.service.js';
import type { CreditNoteStatus, CreateCreditNoteInput } from '../../../../types/billing.js';

export async function GET(
  request: Request,
  { params }: { params: { promoterId: string } },
) {
  const { db } = getServices();
  const url = new URL(request.url);
  const status = url.searchParams.get('status') as CreditNoteStatus | null;
  const year = url.searchParams.get('year');

  const items = await listCreditNotes(
    params.promoterId,
    {
      status: status ?? undefined,
      year: year ? parseInt(year, 10) : undefined,
    },
    db,
  );

  return Response.json({ items });
}

export async function POST(
  request: Request,
  { params }: { params: { promoterId: string } },
) {
  const { db } = getServices();
  const body = await request.json() as Omit<CreateCreditNoteInput, 'promoterId'>;

  const result = await createCreditNote(
    { ...body, promoterId: params.promoterId },
    db,
  );

  return Response.json(result, { status: 201 });
}
