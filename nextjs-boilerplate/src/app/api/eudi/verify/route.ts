/**
 * POST /api/eudi/verify
 *
 * Přijme presentation response (VP token) z peněženky, ověří ji proti verifieru
 * a uloží výsledek (jen pseudonym + boolean claims, ŽÁDNÉ PII).
 * Body: { requestId, vpToken }
 *
 * Fail-closed: bez EUDI configu vrací 503.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { eudiConfig, verifyPresentation } from '@/lib/eudi/verifier';

const schema = z.object({
  requestId: z.string().min(10).max(200),
  vpToken: z.string().min(1).max(100_000),
});

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = eudiConfig();
  if (!cfg) {
    return NextResponse.json({ error: 'EUDI_UNAVAILABLE' }, { status: 503 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  const { requestId, vpToken } = parsed.data;

  return runWithServiceContext(async () => {
    const rowR = await db().query<{ id: string; status: string; expires_at: string }>(
      `SELECT id, status, expires_at::text FROM identity.eudi_verifications WHERE request_id = $1`,
      [requestId],
    );
    const row = rowR.rows[0];
    if (!row) return NextResponse.json({ error: 'REQUEST_NOT_FOUND' }, { status: 404 });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await db().query(`UPDATE identity.eudi_verifications SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [row.id]);
      return NextResponse.json({ error: 'REQUEST_EXPIRED' }, { status: 410 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: 'ALREADY_PROCESSED', status: row.status }, { status: 409 });
    }

    const result = await verifyPresentation(cfg, vpToken, requestId);

    await db().query(
      `UPDATE identity.eudi_verifications
          SET status = $2, claims = $3::jsonb, subject_pseudonym = $4, verified_at = NOW()
        WHERE id = $1`,
      [row.id, result.verified ? 'verified' : 'failed', JSON.stringify(result.claims), result.subjectPseudonym],
    );

    return NextResponse.json({
      verified: result.verified,
      claims: result.claims,
      reason: result.reason,
    });
  });
}
