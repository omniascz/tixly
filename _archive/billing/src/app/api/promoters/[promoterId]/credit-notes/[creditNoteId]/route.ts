/**
 * GET  /promoters/:promoterId/credit-notes/:creditNoteId — get credit note detail
 * POST /promoters/:promoterId/credit-notes/:creditNoteId/issue — issue (draft → issued)
 */
import { getServices } from '../../../../../lib/service-container.js';
import { getCreditNote, issueCreditNote } from '../../../../../services/credit-note.service.js';

export async function GET(
  _request: Request,
  { params }: { params: { promoterId: string; creditNoteId: string } },
) {
  const { db } = getServices();
  const result = await getCreditNote(params.creditNoteId, params.promoterId, db);
  return Response.json(result);
}
