/**
 * POST /api/internal/cron/corporate-orders-overdue (kolo 8 / krok 6)
 *
 * Firemní objednávky nezaplacené po splatnosti → stav 'overdue' a e-mail pořadateli (jednou — overdue_notified_at).
 * Místa zůstávají držená, dokud je pořadatel ručně neuvolní (zrušení objednávky). Denně přes dispatcher.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { escapeHtml } from '@/lib/html-escape/escape';
import { verifyInternalToken } from '@/lib/internal-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const auth = verifyInternalToken(req.headers.get('x-internal-token'));
  if (!auth.ok) {
    console.error('[corporate-orders-overdue] odmítnuto:', auth.reason);
    return NextResponse.json({ error: 'Forbidden', reason: auth.reason }, { status: 403 });
  }
  return runWithServiceContext(async () => {
    const due = (await db().query<{
      id: string; company_name: string; invoice_number: string | null; due_date: string; total: number; currency: string;
      promoter_email: string | null; event_title: string;
    }>(
      `UPDATE b2b_orders.invoice_orders io
          SET status = 'overdue', overdue_notified_at = now(), updated_at = now()
         FROM platform.promoters p, catalog.events e
        WHERE p.id = io.promoter_id AND e.id = io.event_id
          AND io.status IN ('confirmed', 'proforma_sent') AND io.overdue_notified_at IS NULL AND io.order_id IS NOT NULL
          AND io.due_date < (now() AT TIME ZONE 'Europe/Prague')::date
        RETURNING io.id, io.company_name, io.invoice_number, io.due_date::text AS due_date, io.total_amount_hellers::int AS total,
                  io.currency, COALESCE(p.contact_email, p.email) AS promoter_email, e.title AS event_title`,
    )).rows;
    const { sendMail } = await import('@/lib/email/mailer');
    let mailed = 0;
    for (const r of due) {
      if (!r.promoter_email) continue;
      try {
        await sendMail({
          to: r.promoter_email,
          subject: `Faktura ${r.invoice_number ?? ''} po splatnosti — ${r.company_name}`,
          html: `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;padding:24px">
            <p>Firemní objednávka <strong>${escapeHtml(r.company_name)}</strong> na <strong>${escapeHtml(r.event_title)}</strong>
            (faktura ${escapeHtml(r.invoice_number ?? '—')}, ${(r.total / 100).toLocaleString('cs-CZ')} ${escapeHtml(r.currency)})
            nebyla zaplacena do ${escapeHtml(r.due_date)}.</p>
            <p>Místa zůstávají držená. Až rozhodnete, uvolněte je v administraci (Firemní objednávky → Zrušit / uvolnit místa).</p>
          </body></html>`,
        });
        mailed++;
      } catch (e) {
        console.error('[corporate-orders-overdue] mail', r.id, e);
      }
    }
    return NextResponse.json({ ok: true, overdue: due.length, mailed });
  });
}
