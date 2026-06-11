/**
 * GET /api/events/[id]/ticket-types — public list ticket types pro akci
 * + flex pass info (jaký typ pass, kolik picks)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';


interface TtRow {
  id: string;
  name: string;
  base_price: number;
  remaining_qty: number;
  is_seated: boolean;
  picks_required: number | null;
  pass_kind: string | null;
}

// CORS preflight pro cross-origin embed widget. Hlavičky doplní next.config.
export function OPTIONS(): Response {
  return new Response(null, { status: 204 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ ticketTypes: [] });
  }
  // Jen typy PUBLIKOVANÉ akce — public endpoint nesmí prozradit/nabízet typy
  // draft/pending akce. Pod ENFORCED RLS to už hlídá public-read policy, ale
  // explicitní guard drží konzistenci i v dormantním BYPASSRLS režimu.
  const r = await db().query<TtRow>(
    `SELECT tt.id, tt.name, tt.base_price, tt.remaining_qty,
            COALESCE(tt.is_seated, false) AS is_seated,
            f.picks_required, f.pass_kind
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
  }>(
    `SELECT COALESCE(requires_otp_validation, FALSE) AS requires_otp_validation,
            COALESCE(verified_fan_enabled, FALSE) AS verified_fan_enabled
       FROM catalog.events WHERE id = $1`,
    [params.id],
  );
  const flags = ev.rows[0] ?? {
    requires_otp_validation: false,
    verified_fan_enabled: false,
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
    })),
    eventFlags: {
      requiresOtp: flags.requires_otp_validation,
      verifiedFanEnabled: flags.verified_fan_enabled,
    },
  });
}
