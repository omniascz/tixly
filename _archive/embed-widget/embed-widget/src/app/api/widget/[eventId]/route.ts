import { NextRequest, NextResponse } from 'next/server';
import type { WidgetEvent } from '../../../../types/widget.types';

// Povolené originy pro CORS — widget se načítá z cizích domén
const ALLOWED_ORIGINS = ['*'];   // embed je veřejný; auth není potřeba

function corsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes('*') ? '*' : (origin ?? ''),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
  };
}

/**
 * Načte whitelist povolených embed originů pro daného promotéra (podle event ID).
 * V produkci dotaz do `widget_allowed_origins` tabulky.
 */
async function loadAllowedOrigins(_eventId: string): Promise<string[]> {
  // TODO: SELECT origin FROM widget.widget_allowed_origins wao
  //       JOIN catalog.events e ON e.promoter_id = wao.promoter_id
  //       WHERE e.id = $1
  return ['https://*.tixly.cz', 'https://tixly.cz'];
}

function cspHeaders(allowedOrigins: string[]): Record<string, string> {
  const frameAncestors = allowedOrigins.length > 0 ? allowedOrigins.join(' ') : "'none'";
  return {
    'Content-Security-Policy': [
      `frame-ancestors ${frameAncestors}`,
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

// ---------------------------------------------------------------------------
// OPTIONS — preflight
// ---------------------------------------------------------------------------
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('origin')),
  });
}

// ---------------------------------------------------------------------------
// GET /api/widget/[eventId]
// Vrací veřejná data akce potřebná pro zobrazení widgetu.
// Žádné citlivé informace — endpoint je veřejný bez autentizace.
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: { eventId: string } },
) {
  const { eventId } = params;
  const origin = request.headers.get('origin');

  // Validace formátu eventId (UUID nebo slug)
  if (!eventId || eventId.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(eventId)) {
    return NextResponse.json(
      { error: 'Invalid event ID' },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  // TODO: načíst z DB přes DbAdapter (bez withTenantContext — veřejná data)
  // const event = await deps.db.query<EventRow>(
  //   `SELECT e.id, e.name, e.starts_at, e.timezone, e.currency,
  //           v.name AS venue_name, v.city,
  //           array_agg(tt.*) AS ticket_types
  //    FROM catalog.events e
  //    JOIN catalog.venues v ON v.id = e.venue_id
  //    JOIN catalog.ticket_types tt ON tt.event_id = e.id
  //    WHERE e.id = $1 AND e.status = 'published'
  //    GROUP BY e.id, v.id`,
  //   [eventId],
  // );

  // Stub pro vývoj
  const event: WidgetEvent = {
    name: 'Festival Ukázka 2026',
    date: '2026-07-15T18:00:00.000Z',
    venueName: 'Výstaviště Praha',
    city: 'Praha',
    currency: 'CZK',
    locale: 'cs',
    ticketTypes: [
      {
        id: 'tt_early',
        name: 'Early Bird',
        price: 89900,     // 899 Kč v haléřích
        available: 50,
        maxPerOrder: 4,
        phase: 'early_bird',
      },
      {
        id: 'tt_regular',
        name: 'Standardní vstupenka',
        price: 129900,    // 1 299 Kč
        available: 200,
        maxPerOrder: 4,
        phase: 'regular',
      },
      {
        id: 'tt_vip',
        name: 'VIP',
        price: 249900,    // 2 499 Kč
        available: 10,
        maxPerOrder: 2,
        phase: 'regular',
      },
    ],
    checkoutUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://tixly.cz'}/cs/akce/${eventId}/koupit`,
  };

  const allowedOrigins = await loadAllowedOrigins(eventId);

  return NextResponse.json(event, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      ...cspHeaders(allowedOrigins),
    },
  });
}
