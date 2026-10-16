/**
 * GET /api/tickets/[id]/share-card
 * 1080×1080 PNG share karta pro Instagram/TikTok.
 * Auth: x-user-id (owner) nebo ?token= query param.
 */

import { NextRequest } from 'next/server';
import { ImageResponse } from 'next/og';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIZE = 1080;

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const userId = req.headers.get('x-user-id');
  const token  = req.nextUrl.searchParams.get('token');
  if (!userId && !token) return new Response('Unauthorized', { status: 401 });

  const r = await runWithServiceContext(() =>
    db().query(
      `SELECT t.owner_id,
              e.title          AS event_title,
              e.date_start     AS event_date_start,
              e.fan_artwork_url,
              v.name           AS venue_name,
              p.brand_color_hex,
              p.name           AS promoter_name
       FROM tickets.tickets  t
       JOIN orders.orders    o  ON o.id  = t.order_id
       JOIN catalog.events   e  ON e.id  = o.event_id
       LEFT JOIN catalog.venues   v ON v.id = e.venue_id
       LEFT JOIN platform.promoters p ON p.id = e.promoter_id
       WHERE t.id = $1`,
      [params.id],
    ),
  );

  if (r.rows.length === 0) return new Response('Not found', { status: 404 });

  const row = r.rows[0] as {
    owner_id: string;
    event_title: string;
    event_date_start: string | null;
    fan_artwork_url: string | null;
    venue_name: string | null;
    brand_color_hex: string | null;
    promoter_name: string | null;
  };

  if (userId && row.owner_id !== userId) return new Response('Forbidden', { status: 403 });

  const accent = /^#[0-9a-f]{6}$/i.test(row.brand_color_hex ?? '') ? row.brand_color_hex! : '#c9a84c';

  const dateStr = row.event_date_start
    ? new Date(row.event_date_start).toLocaleDateString('cs-CZ', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';

  const titleSize = row.event_title.length > 30 ? 64 : 80;

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE, height: SIZE,
          display: 'flex', flexDirection: 'column',
          backgroundColor: '#0a0a0a',
          position: 'relative', overflow: 'hidden',
        }}
      >
        {row.fan_artwork_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.fan_artwork_url}
            alt=""
            style={{
              position: 'absolute', top: 0, left: 0,
              width: SIZE, height: SIZE,
              objectFit: 'cover', opacity: 0.45,
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute', top: 0, left: 0,
              width: SIZE, height: SIZE,
              background: `radial-gradient(ellipse at 30% 30%, ${accent}44 0%, #0a0a0a 70%)`,
              display: 'flex',
            }}
          />
        )}

        {/* Bottom gradient */}
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0,
            width: SIZE, height: 700,
            background: 'linear-gradient(to top, rgba(0,0,0,0.93) 0%, rgba(0,0,0,0) 100%)',
            display: 'flex',
          }}
        />

        {/* Top: promoter label */}
        <div
          style={{
            position: 'absolute', top: 60, left: 60,
            display: 'flex', alignItems: 'center', gap: 14,
          }}
        >
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: accent }} />
          <span style={{ color: accent, fontSize: 26, fontWeight: 700, letterSpacing: 4 }}>
            {(row.promoter_name ?? 'TIXLY').toUpperCase()}
          </span>
        </div>

        {/* Bottom content */}
        <div
          style={{
            position: 'absolute', bottom: 80, left: 60, right: 60,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <span style={{ color: accent, fontSize: 22, letterSpacing: 4, marginBottom: 18 }}>
            BYL/A JSEM TAM
          </span>

          <span
            style={{
              color: '#ffffff', fontSize: titleSize,
              fontWeight: 700, lineHeight: 1.05, marginBottom: 24,
            }}
          >
            {row.event_title}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 28 }}>{dateStr}</span>
            {row.venue_name ? (
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 28 }}>
                · {row.venue_name}
              </span>
            ) : null}
          </div>
        </div>

        {/* Tixly watermark */}
        <div
          style={{
            position: 'absolute', bottom: 36, right: 60,
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.25)' }} />
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 20, letterSpacing: 3 }}>TIXLY</span>
        </div>
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
