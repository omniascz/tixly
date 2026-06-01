/**
 * GET /api/public/events/[id]/price-preview
 *
 * Eventim-style **veřejná price kalkulačka**. Fanoušek si předem spočítá,
 * kolik zaplatí včetně všech poplatků na vybraném kanálu.
 *
 * Query:
 *   ?channel=online (default), box_office, partner, kiosk, embed
 *   ?ticketTypeId=<uuid> (optional, pokud chybí vrátí všechny)
 *   ?qty=<n> (default 1)
 *
 * Vrací breakdown: { ticketPrice, fees: [...], total }
 *
 * No auth required — purely public utility.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


const ALLOWED_CHANNELS = new Set(['online', 'box_office', 'partner', 'kiosk', 'embed', 'phone']);
const DEFAULT_ONLINE_FEE_PCT = 4.0;
const DEFAULT_BOX_OFFICE_FEE_PCT = 0;
const DEFAULT_PARTNER_FEE_PCT = 6.0;
const DEFAULT_KIOSK_FEE_PCT = 1.5;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const url = new URL(req.url);
  const channel = (url.searchParams.get('channel') ?? 'online').toLowerCase();
  const ticketTypeId = url.searchParams.get('ticketTypeId');
  const qty = Math.max(1, Math.min(50, Number(url.searchParams.get('qty') ?? '1')));

  if (!ALLOWED_CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'INVALID_CHANNEL' }, { status: 422 });
  }

  // Promoter fee policy
  const eventInfo = await db().query<{
    promoter_id: string;
    title: string;
    fee_payer: string | null;
    default_currency: string;
  }>(
    `SELECT e.promoter_id, e.title,
            COALESCE(e.fee_payer, p.default_fee_payer, 'buyer') AS fee_payer,
            COALESCE(e.currency, 'CZK') AS default_currency
       FROM catalog.events e
       JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1 AND e.status = 'published'`,
    [params.id],
  );

  if (eventInfo.rows.length === 0) {
    return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
  }
  const event = eventInfo.rows[0];

  // Load ticket types + channel overrides
  let ttFilter = '';
  const args: unknown[] = [params.id];
  if (ticketTypeId) {
    args.push(ticketTypeId);
    ttFilter = ` AND tt.id = $${args.length}`;
  }

  const ttRes = await db().query<{
    id: string;
    name: string;
    base_price: number;
    channel_override: number | null;
    remaining_qty: number | null;
    visibility: string;
  }>(
    `SELECT tt.id, tt.name, tt.base_price, tt.remaining_qty, tt.visibility,
            (SELECT price_override FROM catalog.ticket_type_channel_prices ttcp
              WHERE ttcp.ticket_type_id = tt.id AND ttcp.channel_key = $${args.length + 1}
                AND (effective_from IS NULL OR effective_from <= now())
                AND (effective_until IS NULL OR effective_until > now())
              LIMIT 1) AS channel_override
       FROM catalog.ticket_types tt
      WHERE tt.event_id = $1 AND tt.visibility = 'public'${ttFilter}
   ORDER BY tt.base_price`,
    [...args, channel],
  );

  const defaultFeePct =
    channel === 'box_office' ? DEFAULT_BOX_OFFICE_FEE_PCT :
    channel === 'partner' ? DEFAULT_PARTNER_FEE_PCT :
    channel === 'kiosk' ? DEFAULT_KIOSK_FEE_PCT :
    DEFAULT_ONLINE_FEE_PCT;

  const tickets = ttRes.rows.map((tt) => {
    const unitPrice = tt.channel_override ?? tt.base_price;
    const subtotal = unitPrice * qty;
    const serviceFee = event.fee_payer === 'buyer'
      ? Math.round(subtotal * (defaultFeePct / 100))
      : 0;
    const total = subtotal + serviceFee;

    return {
      ticketTypeId: tt.id,
      ticketTypeName: tt.name,
      unitPrice,
      qty,
      subtotal,
      fees: event.fee_payer === 'buyer' ? [
        { label: `Servisní poplatek (${defaultFeePct}%)`, amount: serviceFee },
      ] : [],
      total,
      allInPrice: total,
      availability: tt.remaining_qty ?? null,
      isSoldOut: tt.remaining_qty !== null && tt.remaining_qty === 0,
    };
  });

  return NextResponse.json({
    eventId: params.id,
    eventTitle: event.title,
    channel,
    currency: event.default_currency,
    feePayer: event.fee_payer,
    qty,
    tickets,
    disclaimer: event.fee_payer === 'buyer'
      ? `Ceny zahrnují všechny poplatky (All-In). Servisní poplatek ${defaultFeePct}% na kanále "${channel}".`
      : 'Cena beze servisních poplatků — kryje pořadatel.',
  });
}
