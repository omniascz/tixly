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
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


const ALLOWED_CHANNELS = new Set(['online', 'box_office', 'partner', 'kiosk', 'embed', 'phone']);

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
    no_surge_pledge: boolean | null;
  }>(
    // fee_payer (kdo platí service fee) není ve schématu → default 'buyer'.
    // no_surge_pledge čteme migračně bezpečně přes to_jsonb (NULL když sloupec ještě není).
    `SELECT e.promoter_id, e.title,
            'buyer'::text AS fee_payer,
            COALESCE(e.currency, 'CZK') AS default_currency,
            (to_jsonb(e.*) ->> 'no_surge_pledge')::boolean AS no_surge_pledge
       FROM catalog.events e
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

  // Service fee = JEDEN zdroj pravdy (platform.fee_schedules), stejný jako checkout.
  // Fixní částka per vstupenku / per objednávku dle nastavení promotéra. Buyer tak
  // předem vidí přesně to, co u pokladny zaplatí.
  // fee_schedules je access-controlled (RLS) — tenhle veřejný endpoint nemá kontext,
  // proto fee config (= co buyer zaplatí, veřejná info) načteme v service kontextu.
  const { resolveServiceFee } = await import('@/lib/fees/service-fee');
  const svc = await runWithServiceContext(() =>
    resolveServiceFee(db(), {
      promoterId: event.promoter_id,
      currency: event.default_currency,
      quantity: qty,
    }),
  );
  const feeLabel =
    svc.basis === 'per_ticket'
      ? `Servisní poplatek (${(svc.unitFeeMinor / 100).toFixed(2)} ${event.default_currency}/vstupenku)`
      : `Servisní poplatek (${(svc.unitFeeMinor / 100).toFixed(2)} ${event.default_currency}/objednávku)`;

  const tickets = ttRes.rows.map((tt) => {
    const unitPrice = tt.channel_override ?? tt.base_price;
    const subtotal = unitPrice * qty;
    const serviceFee = svc.totalFeeMinor;
    const total = subtotal + serviceFee;

    return {
      ticketTypeId: tt.id,
      ticketTypeName: tt.name,
      unitPrice,
      qty,
      subtotal,
      fees: serviceFee > 0 ? [{ label: feeLabel, amount: serviceFee }] : [],
      total,
      allInPrice: total,
      availability: tt.remaining_qty ?? null,
      isSoldOut: tt.remaining_qty !== null && tt.remaining_qty === 0,
    };
  });

  const noSurgePledge = event.no_surge_pledge === true;

  return NextResponse.json({
    eventId: params.id,
    eventTitle: event.title,
    channel,
    currency: event.default_currency,
    feePayer: event.fee_payer,
    serviceFeeBasis: svc.basis,
    qty,
    tickets,
    // Poctivá cena — všechno all-in, žádné skryté poplatky u pokladny.
    honestPricing: {
      allIn: true,
      noSurgePledge,
      guarantee: noSurgePledge
        ? 'Poctivá cena: co vidíš, to zaplatíš — cena se u této akce nikdy nezvýší nad zveřejněnou.'
        : 'Cena je all-in včetně všech poplatků. Žádné skryté poplatky u pokladny.',
    },
    disclaimer:
      svc.totalFeeMinor > 0
        ? `Ceny jsou All-In. ${feeLabel}.`
        : 'Bez servisního poplatku.',
  });
}
