/**
 * POST /api/admin/events/[id]/offers/[offerId]/send
 *
 * Vydá jednorázový odkaz pro agenta a nabídku označí jako odeslanou.
 * Odkaz se vrací **jen v téhle odpovědi** — v databázi zůstává pouze otisk,
 * takže ho nejde získat zpětně. Když se ztratí, vydá se nový.
 *
 * Body: { validDays?: 1–90 }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { issueOfferToken } from '@/lib/booking/offer-token';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  validDays: z.number().int().min(1).max(90).optional(),
});

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; offerId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    const validDays = parsed.success ? (parsed.data.validDays ?? 14) : 14;

    const cur = await runWithServiceContext(() =>
      db().query<{ status: string; agent_email: string | null; artist_email: string | null }>(
        `SELECT status, agent_email, artist_email
         FROM lineups.artist_offers
         WHERE id = $1 AND event_id = $2 AND promoter_id = $3`,
        [params.offerId, params.id, promoter.promoterId],
      ),
    );
    const offer = cur.rows[0];
    if (!offer) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (offer.status === 'accepted' || offer.status === 'superseded') {
      return NextResponse.json(
        {
          error: 'OFFER_CLOSED',
          message: 'Tahle nabídka je uzavřená. Pro nové podmínky vytvoř novou verzi.',
        },
        { status: 409 },
      );
    }
    if (!offer.agent_email && !offer.artist_email) {
      return NextResponse.json(
        {
          error: 'NO_RECIPIENT',
          message: 'Nabídka nemá e-mail agenta ani umělce — není komu poslat odkaz.',
        },
        { status: 422 },
      );
    }

    const issued = issueOfferToken(validDays, new Date());

    await runWithServiceContext(() =>
      db().query(
        `UPDATE lineups.artist_offers
         SET access_token_hash = $2, token_expires_at = $3,
             status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [params.offerId, issued.hash, issued.expiresAt.toISOString()],
      ),
    );

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000';

    return NextResponse.json({
      ok: true,
      status: 'sent',
      /** Jediné místo, kde odkaz uvidíš. Zpětně ho nejde získat. */
      link: `${baseUrl}/nabidka/${issued.token}`,
      expiresAt: issued.expiresAt.toISOString(),
      recipient: offer.agent_email ?? offer.artist_email,
      message:
        'Odkaz vydán. Ulož si ho hned — v systému zůstává jen jeho otisk, znovu ho zobrazit nejde.',
    });
  });
}
