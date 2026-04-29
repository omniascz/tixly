/**
 * GET /api/ai/cover-stub?seed=...&hue=...&palette=...&title=...
 *
 * Deterministic placeholder cover image (1792×1024) pro demo režim AI_IMAGE_MODE=stub.
 * V produkci by tato route nebyla použita — DALL-E vrátil real URL.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const revalidate = 86400;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const hue = Number(url.searchParams.get('hue') ?? '270');
  const paletteHex = url.searchParams.get('palette') ?? '6C47FF';
  const title = url.searchParams.get('title') ?? 'Event';
  const seed = url.searchParams.get('seed') ?? 'abc12345';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: `linear-gradient(135deg, hsl(${hue}, 70%, 35%) 0%, #${paletteHex} 50%, hsl(${(hue + 90) % 360}, 80%, 25%) 100%)`,
          color: '#fff',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Decorative shapes for variation */}
        <div
          style={{
            position: 'absolute',
            top: '20%',
            right: '15%',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '10%',
            left: '5%',
            width: 600,
            height: 200,
            borderRadius: '50%',
            background: `radial-gradient(ellipse, rgba(255,255,255,0.12), transparent 70%)`,
            transform: 'rotate(-10deg)',
          }}
        />
        <div style={{ fontSize: 28, fontWeight: 700, opacity: 0.9, zIndex: 1 }}>
          AI cover · stub
        </div>
        <div style={{ zIndex: 1 }}>
          <div
            style={{
              fontSize: title.length > 30 ? 80 : 110,
              fontWeight: 900,
              lineHeight: 1,
              maxWidth: 1500,
              textShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}
          >
            {title}
          </div>
        </div>
        <div style={{ fontSize: 18, opacity: 0.6, zIndex: 1 }}>seed:{seed}</div>
      </div>
    ),
    {
      width: 1792,
      height: 1024,
    },
  );
}
