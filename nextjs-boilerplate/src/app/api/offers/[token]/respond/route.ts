/**
 * POST /api/offers/[token]/respond — odpověď agenta na nabídku
 *
 * Tři možnosti: přijmout, odmítnout, poslat protinávrh.
 *
 * **Přijetím se nabídka překlopí do smlouvy a do rozpočtu akce** — vznikne
 * smlouva o honoráři se stejnými čísly a nákladová položka, aby bod zlomu
 * počítal s honorářem od první chvíle. Nic se nikam nepřepisuje ručně.
 *
 * Přijetí je podpis podle eIDAS SES: souhlas, čas, maskovaná IP a otisk
 * konkrétní verze podmínek. Agent u nás účet nemá, proto se podpis ukládá
 * přímo na nabídku.
 */

import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { canRespond, hashOfferToken } from '@/lib/booking/offer-token';
import { maskIpForGdpr } from '@/lib/compliance/e-signature';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  action: z.enum(['accept', 'decline', 'counter']),
  signerName: z.string().min(1).max(200).optional(),
  signerEmail: z.string().email().max(200).optional(),
  note: z.string().max(4000).optional(),
});

interface OfferForResponse {
  id: string;
  promoter_id: string;
  event_id: string | null;
  status: string;
  valid_until: string | null;
  token_expires_at: string | null;
  artist_name: string;
  artist_email: string | null;
  currency: string;
  royalty_type: string;
  percent_rate: string | null;
  flat_amount_halire: number | null;
  per_ticket_halire: number | null;
  min_guarantee_halire: number | null;
  cap_halire: number | null;
  deposit_minor: number;
  backend_pct: string | null;
  bonus_tiers: unknown;
  split_pct: string;
  percent_base: string;
  withholding_tax_pct: string;
  tax_residency: string | null;
  agreement_id: string | null;
}

/** Otisk podepsané verze — počítá se z podmínek, ne z vykreslené stránky. */
function hashTerms(o: OfferForResponse): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        v: 1,
        offer: o.id,
        artist: o.artist_name,
        currency: o.currency,
        type: o.royalty_type,
        percent: o.percent_rate,
        base: o.percent_base,
        flat: o.flat_amount_halire,
        perTicket: o.per_ticket_halire,
        guarantee: o.min_guarantee_halire,
        cap: o.cap_halire,
        deposit: o.deposit_minor,
        backend: o.backend_pct,
        bonus: o.bonus_tiers,
        split: o.split_pct,
        withholding: o.withholding_tax_pct,
      }),
      'utf8',
    )
    .digest('hex');
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } },
): Promise<Response> {
  const raw: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
  }
  const b = parsed.data;

  if (!/^[A-Za-z0-9_-]{20,120}$/.test(params.token)) {
    return NextResponse.json({ error: 'NOT_AVAILABLE' }, { status: 404 });
  }
  const hash = hashOfferToken(params.token);
  const now = new Date();

  return runWithServiceContext(async () => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const r = await client.query<OfferForResponse>(
        `SELECT id, promoter_id, event_id, status, valid_until, token_expires_at,
                artist_name, artist_email, currency, royalty_type, percent_rate,
                flat_amount_halire, per_ticket_halire, min_guarantee_halire, cap_halire,
                deposit_minor, backend_pct, bonus_tiers, split_pct, percent_base,
                withholding_tax_pct, tax_residency, agreement_id
         FROM lineups.artist_offers
         WHERE access_token_hash = $1
         FOR UPDATE`,
        [hash],
      );
      const offer = r.rows[0];
      if (!offer) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'NOT_AVAILABLE' }, { status: 404 });
      }
      if (offer.token_expires_at !== null && new Date(offer.token_expires_at) < now) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'LINK_EXPIRED', message: 'Platnost odkazu vypršela.' },
          { status: 410 },
        );
      }
      if (!canRespond(offer.status, offer.valid_until ? new Date(offer.valid_until) : null, now)) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'CANNOT_RESPOND',
            message:
              offer.status === 'accepted'
                ? 'Nabídka už byla přijata.'
                : 'Na tuhle nabídku už nelze odpovědět.',
          },
          { status: 409 },
        );
      }

      const ip = maskIpForGdpr(
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0',
      );

      if (b.action === 'decline') {
        await client.query(
          `UPDATE lineups.artist_offers
           SET status = 'declined', responded_at = NOW(), counter_note = $2, updated_at = NOW()
           WHERE id = $1`,
          [offer.id, b.note ?? null],
        );
        await client.query('COMMIT');
        return NextResponse.json({ ok: true, status: 'declined' });
      }

      if (b.action === 'counter') {
        if (!b.note || b.note.trim().length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'NOTE_REQUIRED', message: 'U protinávrhu napiš, co chceš změnit.' },
            { status: 422 },
          );
        }
        await client.query(
          `UPDATE lineups.artist_offers
           SET status = 'countered', responded_at = NOW(), counter_note = $2, updated_at = NOW()
           WHERE id = $1`,
          [offer.id, b.note],
        );
        await client.query('COMMIT');
        return NextResponse.json({
          ok: true,
          status: 'countered',
          message: 'Protinávrh odeslán pořadateli.',
        });
      }

      // --- Přijetí -----------------------------------------------------------
      if (!b.signerName) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'SIGNER_REQUIRED', message: 'K přijetí uveď jméno podepisujícího.' },
          { status: 422 },
        );
      }
      if (!offer.event_id) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'NO_EVENT',
            message: 'Nabídka není navázaná na akci — přijetí by nemělo kam překlopit podmínky.',
          },
          { status: 409 },
        );
      }

      // 1) Smlouva o honoráři se stejnými čísly.
      const agr = await client.query<{ id: string }>(
        `INSERT INTO lineups.royalty_agreements
           (event_id, promoter_id, artist_name, artist_email, currency,
            royalty_type, percent_rate, flat_amount_halire, per_ticket_halire,
            min_guarantee_halire, cap_halire, deposit_minor, backend_pct, bonus_tiers,
            split_pct, percent_base, withholding_tax_pct, tax_residency, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)
         RETURNING id`,
        [
          offer.event_id,
          offer.promoter_id,
          offer.artist_name,
          offer.artist_email,
          offer.currency,
          offer.royalty_type,
          offer.percent_rate,
          offer.flat_amount_halire,
          offer.per_ticket_halire,
          offer.min_guarantee_halire,
          offer.cap_halire,
          offer.deposit_minor,
          offer.backend_pct,
          JSON.stringify(offer.bonus_tiers ?? []),
          offer.split_pct,
          offer.percent_base,
          offer.withholding_tax_pct,
          offer.tax_residency,
          `Vzniklo přijetím nabídky ${offer.id}`,
        ],
      );
      const agreementId = agr.rows[0].id;

      // 2) Nákladová položka v rozpočtu — aby bod zlomu počítal s honorářem
      //    od první chvíle. Zapisuje se garance nebo pevná částka; podíl z tržby
      //    se do pevných nákladů zapsat nedá, protože není znám dopředu.
      const fixedPart =
        offer.min_guarantee_halire ?? (offer.royalty_type === 'flat' ? offer.flat_amount_halire : 0);
      let costId: string | null = null;
      if (fixedPart && fixedPart > 0) {
        const cost = await client.query<{ id: string }>(
          `INSERT INTO catalog.event_costs
             (event_id, promoter_id, category, description, amount_minor,
              vat_rate_pct, is_per_attendee, royalty_agreement_id, notes)
           VALUES ($1,$2,'artist',$3,$4,0,FALSE,$5,$6)
           RETURNING id`,
          [
            offer.event_id,
            offer.promoter_id,
            `Honorář — ${offer.artist_name}`,
            fixedPart,
            agreementId,
            'Vzniklo přijetím nabídky. Částka se mění ve smlouvě s umělcem.',
          ],
        );
        costId = cost.rows[0].id;
      }

      const docHash = hashTerms(offer);
      await client.query(
        `UPDATE lineups.artist_offers
         SET status = 'accepted', responded_at = NOW(), signed_at = NOW(),
             signer_name = $2, signer_email = $3, signer_ip = $4, document_hash = $5,
             agreement_id = $6, cost_id = $7, updated_at = NOW()
         WHERE id = $1`,
        [offer.id, b.signerName, b.signerEmail ?? null, ip, docHash, agreementId, costId],
      );

      await client.query('COMMIT');
      return NextResponse.json({
        ok: true,
        status: 'accepted',
        documentHash: docHash,
        message: 'Nabídka přijata a podepsána. Pořadateli se podmínky propsaly do smlouvy.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[offer respond]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
