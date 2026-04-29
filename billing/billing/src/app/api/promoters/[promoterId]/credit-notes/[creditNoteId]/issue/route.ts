/**
 * POST /promoters/:promoterId/credit-notes/:creditNoteId/issue
 *
 * Issue a credit note (draft → issued).
 */
import { getServices } from '../../../../../../lib/service-container.js';
import { issueCreditNote } from '../../../../../../services/credit-note.service.js';

export async function POST(
  _request: Request,
  { params }: { params: { promoterId: string; creditNoteId: string } },
) {
  const { db } = getServices();
  const result = await issueCreditNote(params.creditNoteId, params.promoterId, db);
  return Response.json(result);
}
