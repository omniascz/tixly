/**
 * GET /api/og/events/[id]
 *
 * Vrací 1200×630 PNG OG image (hash-based gradient + event title).
 * Cache 1h pro fast Open Graph crawler responses.
 */

import { ImageResponse } from 'next/og';

// EDGE runtime — next/og je pro edge stavěné (v nodejs runtime hází „Invalid URL").
// Edge nemůže `pg`, takže data tahá fetchem z /api/public/events/[id]/og-data.
export const runtime = 'edge';
export const revalidate = 3600;

export async function GET(req: Request, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return new Response('Invalid id', { status: 422 });
  }

  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/public/events/${params.id}/og-data`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    return new Response('Not found', { status: 404 });
  }
  const ev = (await res.json()) as {
    title: string;
    dateStart: string;
    venueName: string | null;
    promoterName: string | null;
    brandColorHex: string | null;
  };

  // Brand color promotéra > fallback hash hue
  let bgGradient: string;
  if (ev.brandColorHex && /^#[0-9a-f]{6}$/i.test(ev.brandColorHex)) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ev.brandColorHex)!;
    const r0 = parseInt(m[1], 16);
    const g0 = parseInt(m[2], 16);
    const b0 = parseInt(m[3], 16);
    const darker = `rgb(${Math.round(r0 * 0.7)}, ${Math.round(g0 * 0.7)}, ${Math.round(b0 * 0.7)})`;
    bgGradient = `linear-gradient(135deg, ${ev.brandColorHex} 0%, ${darker} 100%)`;
  } else {
    const hue = [...params.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
    bgGradient = `linear-gradient(135deg, hsl(${hue}, 70%, 45%) 0%, hsl(${(hue + 60) % 360}, 75%, 35%) 100%)`;
  }
  const dateStr = new Date(ev.dateStart).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px',
          background: bgGradient,
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 32, fontWeight: 700, opacity: 0.9 }}>
          {ev.promoterName ?? 'Tixly'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: ev.title.length > 40 ? 56 : 72,
              fontWeight: 800,
              lineHeight: 1.05,
              maxWidth: 1080,
            }}
          >
            {ev.title}
          </div>
          <div style={{ fontSize: 28, opacity: 0.95 }}>
            {`${dateStr}${ev.venueName ? ` · ${ev.venueName}` : ''}`}
          </div>
        </div>
        <div style={{ fontSize: 20, opacity: 0.8 }}>tixly.cz</div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
