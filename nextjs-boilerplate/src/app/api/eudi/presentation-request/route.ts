/**
 * POST /api/eudi/presentation-request
 *
 * Zahájí ověření přes EU Digital Identity Wallet (OpenID4VP, selektivní zveřejnění).
 * Body: { eventId, orderId? }
 * Vrací: { requestId, openid4vpUri, presentationDefinition, expiresInSec }
 *
 * Fail-closed: bez EUDI_VERIFIER_URL + EUDI_CLIENT_ID vrací 503 (nefejkuje).
 */
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { eudiConfig, buildPresentationDefinition, type RequestedProofs } from '@/lib/eudi/verifier';

const schema = z.object({
  eventId: z.string().uuid(),
  orderId: z.string().uuid().optional(),
});

function nonce(): string {
  return randomBytes(24).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = eudiConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error: 'EUDI_UNAVAILABLE',
        message: 'Ověření evropskou peněženkou zatím není aktivní (chybí EUDI verifier config).',
      },
      { status: 503 },
    );
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues }, { status: 422 });
  const { eventId, orderId } = parsed.data;

  return runWithServiceContext(async () => {
    // Které důkazy akce vyžaduje (migračně bezpečně přes to_jsonb).
    const evR = await db().query<{ eudi_required: RequestedProofs | null }>(
      `SELECT (to_jsonb(e.*) -> 'eudi_required') AS eudi_required
         FROM catalog.events e WHERE e.id = $1 AND e.status = 'published'`,
      [eventId],
    );
    if (evR.rows.length === 0) return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
    const proofs = evR.rows[0].eudi_required;
    if (!proofs || (!proofs.age18 && !proofs.samePerson && !proofs.residency)) {
      return NextResponse.json({ error: 'EUDI_NOT_REQUIRED', message: 'Tato akce nevyžaduje ověření peněženkou.' }, { status: 422 });
    }

    const requestId = nonce();
    const pd = buildPresentationDefinition(proofs, requestId);

    await db().query(
      `INSERT INTO identity.eudi_verifications (request_id, event_id, order_id, status)
       VALUES ($1, $2, $3, 'pending')`,
      [requestId, eventId, orderId ?? null],
    );

    const openid4vpUri =
      `openid4vp://authorize?client_id=${encodeURIComponent(cfg.clientId)}` +
      `&nonce=${encodeURIComponent(requestId)}` +
      `&presentation_definition=${encodeURIComponent(JSON.stringify(pd))}`;

    return NextResponse.json({
      requestId,
      openid4vpUri,
      presentationDefinition: pd,
      expiresInSec: 600,
    });
  });
}
