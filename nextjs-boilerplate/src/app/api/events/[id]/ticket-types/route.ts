/**
 * GET /api/events/[id]/ticket-types — public list ticket types pro akci
 * + flex pass info (jaký typ pass, kolik picks)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { mockPaymentsAllowed } from '@/lib/payment/mock-guard';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


interface TtRow {
  id: string;
  name: string;
  base_price: number;
  remaining_qty: number;
  is_seated: boolean;
  picks_required: number | null;
  pass_kind: string | null;
  presale_code_required: boolean;
  presale_starts_at: string | null;
  presale_ends_at: string | null;
}

// CORS preflight pro cross-origin embed widget. Hlavičky doplní next.config.
export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  // FIX K8a (kolo 3): neplatné ID je chyba vstupu → 400 (dřív 200 []); přesný tvar UUID —
  // volné [0-9a-f-]{36} pustilo např. 36 pomlček až do SQL (uuid cast → 500). Tělo dál nese
  // `ticketTypes: []`, které čtou volající (checkout, embed, mobil).
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'INVALID_EVENT_ID', ticketTypes: [] }, { status: 400 });
  }
  // Jen typy PUBLIKOVANÉ akce — public endpoint nesmí prozradit/nabízet typy
  // draft/pending akce. Pod ENFORCED RLS to už hlídá public-read policy, ale
  // explicitní guard drží konzistenci i v dormantním BYPASSRLS režimu.
  const r = await db().query<TtRow>(
    `SELECT tt.id, tt.name, tt.base_price, tt.remaining_qty,
            COALESCE(tt.is_seated, false) AS is_seated,
            f.picks_required, f.pass_kind,
            COALESCE(tt.presale_code_required, false) AS presale_code_required,
            tt.presale_starts_at::text AS presale_starts_at,
            tt.presale_ends_at::text AS presale_ends_at
     FROM catalog.ticket_types tt
     JOIN catalog.events e ON e.id = tt.event_id AND e.status = 'published'
     LEFT JOIN catalog.flex_pass_settings f ON f.ticket_type_id = tt.id
     WHERE tt.event_id = $1
     ORDER BY tt.base_price`,
    [params.id],
  );

  // Event-level flags potřebné v checkout UI: requires_otp_validation,
  // verified_fan_enabled. Bez nich buyer netuší, že potřebuje OTP/presale_code.
  const ev = await db().query<{
    requires_otp_validation: boolean;
    verified_fan_enabled: boolean;
    meta_pixel_id: string | null;
    currency: string | null;
    legacy_payment_gateways: boolean;
  }>(
    `SELECT COALESCE(e.requires_otp_validation, FALSE) AS requires_otp_validation,
            COALESCE(e.verified_fan_enabled, FALSE) AS verified_fan_enabled,
            p.meta_pixel_id, e.currency, e.legacy_payment_gateways
       FROM catalog.events e
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.id = $1`,
    [params.id],
  );
  const flags = ev.rows[0] ?? {
    requires_otp_validation: false,
    verified_fan_enabled: false,
    meta_pixel_id: null,
    currency: null,
    legacy_payment_gateways: false,
  };

  return NextResponse.json({
    ticketTypes: r.rows.map((t) => ({
      id: t.id,
      name: t.name,
      basePrice: t.base_price,
      remainingQty: t.remaining_qty,
      isSeated: t.is_seated,
      passSettings:
        t.pass_kind && t.picks_required
          ? { kind: t.pass_kind, picksRequired: t.picks_required }
          : null,
      presaleCodeRequired: t.presale_code_required,
      presaleStartsAt: t.presale_starts_at,
      presaleEndsAt: t.presale_ends_at,
    })),
    eventFlags: {
      requiresOtp: flags.requires_otp_validation,
      verifiedFanEnabled: flags.verified_fan_enabled,
    },
    metaPixelId: flags.meta_pixel_id,
    currency: flags.currency ?? 'CZK',
    // Kolo 7: brány bez refundu (Triple-A, P24, Mollie, PayPal, Stripe) jen u akcí z doby před mig. 499.
    legacyPaymentGateways: flags.legacy_payment_gateways === true,
    // Kolo 23: Wero má jen mock bránu — nabízí se jen tam, kde je mock povolený (mock-guard).
    weroAvailable: mockPaymentsAllowed(),
  });
}
