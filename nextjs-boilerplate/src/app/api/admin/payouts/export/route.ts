/**
 * GET /api/admin/payouts/export?month=YYYY-MM&format=csv
 *
 * Měsíční report tržeb pro účetnictví. Defaultně aktuální měsíc.
 *
 * Sloupce CSV:
 *   datum, číslo objednávky, kupec, email, akce, typ lístku, počet,
 *   cena s DPH, základ daně, sazba DPH, DPH, měna, platba, stav
 *
 * DPH se počítá z promoter.vat_rate_pct (default 10 % pro kulturní akce).
 * Refundované objednávky se zobrazují s minus částkou.
 *
 * Pozn.: tohle není stejné jako orders.invoices/export (faktury) — tohle je
 * raw report tržeb pro účetní jako podklad k DPH přiznání.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';


function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatHalireToCzk(halire: number): string {
  return (halire / 100).toFixed(2).replace('.', ',');
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const url = req.nextUrl;
  const month = url.searchParams.get('month'); // YYYY-MM
  let from: string;
  let to: string;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const nextMonth = new Date(y, m, 1);
    to = nextMonth.toISOString().slice(0, 10);
  } else {
    const now = new Date();
    from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    to = nextMonth.toISOString().slice(0, 10);
  }

  // Promoter VAT rate
  const pRes = await db().query<{ vat_rate_pct: number }>(
    `SELECT vat_rate_pct FROM platform.promoters WHERE id = $1`,
    [promoter.promoterId],
  );
  const vatRatePct = pRes.rows[0]?.vat_rate_pct ?? 10;

  const r = await db().query<{
    order_id: string;
    paid_at: string;
    buyer_name: string | null;
    buyer_email: string;
    event_title: string;
    ticket_type_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    currency: string;
    payment_provider: string;
    status: string;
  }>(
    `SELECT o.id AS order_id,
            COALESCE(o.paid_at, o.created_at) AS paid_at,
            u.name AS buyer_name, u.email AS buyer_email,
            e.title AS event_title,
            tt.name AS ticket_type_name,
            oi.quantity, oi.unit_price, oi.total_price,
            o.currency, o.payment_provider, o.status
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     JOIN orders.order_items oi ON oi.order_id = o.id
     JOIN catalog.ticket_types tt ON tt.id = oi.ticket_type_id
     WHERE e.promoter_id = $1
       AND o.status IN ('paid', 'paid_partial', 'refunded')
       AND COALESCE(o.paid_at, o.created_at) >= $2::timestamp
       AND COALESCE(o.paid_at, o.created_at) < $3::timestamp
     ORDER BY paid_at DESC, o.id`,
    [promoter.promoterId, from, to],
  );

  const header = [
    'datum',
    'cislo_objednavky',
    'kupec',
    'email',
    'akce',
    'typ_listku',
    'pocet',
    'cena_celkem_s_DPH',
    'zaklad_dane',
    'sazba_DPH_pct',
    'DPH',
    'mena',
    'platba',
    'stav',
  ].join(';');

  const lines = r.rows.map((row) => {
    const sign = row.status === 'refunded' ? -1 : 1;
    const gross = row.total_price * sign;
    const net = Math.round(gross / (1 + vatRatePct / 100));
    const vat = gross - net;
    return [
      new Date(row.paid_at).toLocaleDateString('cs-CZ'),
      row.order_id,
      row.buyer_name ?? '',
      row.buyer_email,
      row.event_title,
      row.ticket_type_name,
      row.quantity * sign,
      formatHalireToCzk(gross),
      formatHalireToCzk(net),
      vatRatePct,
      formatHalireToCzk(vat),
      row.currency,
      row.payment_provider,
      row.status,
    ]
      .map(csvEscape)
      .join(';');
  });

  // BOM aby Excel správně otevřel UTF-8
  const csv = '﻿' + [header, ...lines].join('\n');
  const filename = `tixly-trzby-${from.slice(0, 7)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });

  });
}
