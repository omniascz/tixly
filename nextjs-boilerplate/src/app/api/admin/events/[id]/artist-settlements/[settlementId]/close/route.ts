/**
 * POST /api/admin/events/[id]/artist-settlements/[settlementId]/close
 *
 * Uzavře vyúčtování: zmrazí čísla, spočítá otisk dokumentu a založí výplatní
 * dávku umělci. Od té chvíle se částky nemění — refund, který přijde později,
 * se řeší dodatkem, ne přepsáním.
 *
 * Uzavření je jednosměrné. Kdo se splete, vystaví dodatek; tím zůstane
 * dohledatelné, co agent podepsal.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';
import type { FeeLine } from '@/lib/royalties/deal';
import {
  ALREADY_PAID_LINE_KEY,
  COMMITTED_PAYOUT_STATUSES_SQL,
  hashSettlement,
  type SettlementSnapshot,
} from '@/lib/royalties/settlement-doc';

export const dynamic = 'force-dynamic';

interface SettlementRow {
  id: string;
  status: string;
  agreement_id: string;
  artist_name: string;
  artist_email: string | null;
  currency: string;
  capacity: number;
  tickets_sold: number;
  gross_revenue_minor: number;
  ticket_vat_rate_pct: number;
  net_revenue_minor: number;
  fixed_costs_minor: number;
  per_attendee_cost_minor: number;
  fee_minor: number;
  share_minor: number;
  deposit_minor: number;
  withholding_minor: number;
  payable_minor: number;
  lines: FeeLine[];
  event_title: string;
  event_date: string;
  bank_iban: string | null;
  bank_bic: string | null;
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string; settlementId: string }> }
): Promise<Response> {
  const params = await props.params;
  return runAsActivePromoter(req, async (promoter) => {
    const client = await db().connect();
    try {
      await client.query('BEGIN');

      const r = await client.query<SettlementRow>(
        `SELECT s.*, e.title AS event_title, e.date_start::text AS event_date,
                a.bank_iban, a.bank_bic
         FROM lineups.artist_settlements s
         JOIN catalog.events e ON e.id = s.event_id
         JOIN lineups.royalty_agreements a ON a.id = s.agreement_id
         WHERE s.id = $1 AND s.event_id = $2 AND s.promoter_id = $3
         FOR UPDATE OF s`,
        [params.settlementId, params.id, promoter.promoterId],
      );
      const s = r.rows[0];
      if (!s) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      if (s.status !== 'draft') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'ALREADY_CLOSED',
            message: 'Vyúčtování je už uzavřené. Změna se řeší dodatkem, ne přepsáním.',
          },
          { status: 409 },
        );
      }

      const snapshot: SettlementSnapshot = {
        eventTitle: s.event_title,
        eventDate: s.event_date,
        artistName: s.artist_name,
        currency: s.currency,
        capacity: s.capacity,
        ticketsSold: s.tickets_sold,
        grossRevenueMinor: s.gross_revenue_minor,
        ticketVatRatePct: s.ticket_vat_rate_pct,
        netRevenueMinor: s.net_revenue_minor,
        fixedCostsMinor: s.fixed_costs_minor,
        perAttendeeCostMinor: s.per_attendee_cost_minor,
        feeMinor: s.fee_minor,
        shareMinor: s.share_minor,
        depositMinor: s.deposit_minor,
        withholdingMinor: s.withholding_minor,
        payableMinor: s.payable_minor,
        lines: s.lines,
      };
      const hash = hashSettlement(snapshot);

      // Výplatní dávka vzniká jen tehdy, když je co vyplácet. Záporná částka
      // znamená, že záloha převýšila honorář — to se řeší mimo výplatu.
      // Mezi sestavením a uzavřením mohla průběžná výplata změnit stav
      // (schválena / odeslána). Pak by zmrazené „již vyplaceno" nesedělo
      // a umělec by dostal víc nebo míň — uzavírat se smí jen aktuální koncept.
      await client.query(
        `SELECT id FROM lineups.artist_payouts WHERE agreement_id = $1 FOR UPDATE`,
        [s.agreement_id],
      );
      const paidNow = await client.query<{ paid: number }>(
        `SELECT COALESCE(SUM(net_payout_halire), 0)::int AS paid
         FROM lineups.artist_payouts
         WHERE agreement_id = $1 AND status IN ${COMMITTED_PAYOUT_STATUSES_SQL}`,
        [s.agreement_id],
      );
      const alreadyPaidMinor = paidNow.rows[0]?.paid ?? 0;
      const draftAlreadyPaid = -(
        s.lines.find((l) => l.key === ALREADY_PAID_LINE_KEY)?.amountMinor ?? 0
      );
      if (alreadyPaidMinor !== draftAlreadyPaid) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'STALE_DRAFT',
            message:
              'Od sestavení vyúčtování se změnily výplaty umělci. Sestav vyúčtování znovu, ať sedí „již vyplaceno".',
          },
          { status: 409 },
        );
      }

      // Nevyřízené průběžné výplaty nahrazuje výplata z vyúčtování.
      const cancelled = await client.query(
        `UPDATE lineups.artist_payouts
         SET status = 'cancelled',
             notes = CONCAT_WS(E'\\n', notes, $2::text),
             updated_at = NOW()
         WHERE agreement_id = $1 AND status = 'pending'`,
        [s.agreement_id, `Nahrazeno vyúčtováním ${params.settlementId}`],
      );

      let payoutId: string | null = null;
      if (s.payable_minor > 0) {
        const p = await client.query<{ id: string }>(
          `INSERT INTO lineups.artist_payouts
             (agreement_id, promoter_id, artist_name, artist_email,
              bank_iban, bank_bic, period_from, period_to,
              gross_royalties_halire, adjustments_halire, net_payout_halire,
              currency, status, created_by_user_id, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14)
           RETURNING id`,
          [
            s.agreement_id,
            promoter.promoterId,
            s.artist_name,
            s.artist_email,
            s.bank_iban,
            s.bank_bic,
            s.event_date,
            s.event_date,
            s.fee_minor,
            -(s.deposit_minor + s.withholding_minor + alreadyPaidMinor),
            s.payable_minor,
            s.currency,
            promoter.userId,
            `Vyúčtování ${params.settlementId}`,
          ],
        );
        payoutId = p.rows[0].id;
      }

      await client.query(
        `UPDATE lineups.artist_settlements
         SET status = 'closed', closed_at = NOW(), closed_by_user_id = $2,
             document_hash = $3, payout_id = $4, updated_at = NOW()
         WHERE id = $1`,
        [params.settlementId, promoter.userId, hash, payoutId],
      );

      await client.query(
        `INSERT INTO audit.audit_log
           (schema_name, table_name, record_id, action, actor_id, actor_type, new_values)
         VALUES ('lineups','artist_settlements',$1,'UPDATE',$2,'user',$3::jsonb)`,
        [
          params.settlementId,
          promoter.userId,
          JSON.stringify({
            kind: 'artist_settlement_close',
            payable_minor: s.payable_minor,
            document_hash: hash,
            payout_id: payoutId,
            already_paid_minor: alreadyPaidMinor,
            cancelled_pending_payouts: cancelled.rowCount ?? 0,
          }),
        ],
      );

      await client.query('COMMIT');
      return NextResponse.json({
        ok: true,
        status: 'closed',
        documentHash: hash,
        payoutId,
        message:
          payoutId === null
            ? 'Vyúčtování uzavřeno. Výplata nevznikla — není co vyplácet.'
            : 'Vyúčtování uzavřeno a výplata založena.',
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[artist-settlement close]', err);
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
