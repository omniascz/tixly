/**
 * GET /api/admin/events/[id]/marketing-qr/[campaignId]/png
 *
 * Vrací PNG buffer s QR kódem směrujícím na /qr/[slug]. Velikost je high-res
 * (default 600px) pro tisk na A4 plakát. Promotér si stáhne, vloží do Canva,
 * vytiskne.
 *
 * Query: ?size=300|600|900 (default 600), ?format=png (zatím jen PNG)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import QRCode from 'qrcode';


export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; campaignId: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<{ slug: string; name: string }>(
    `SELECT slug, name FROM marketing.qr_campaigns
     WHERE id = $1 AND event_id = $2`,
    [params.campaignId, params.id],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const campaign = r.rows[0];

  const sizeParam = Number(new URL(req.url).searchParams.get('size') ?? '600');
  const size = [300, 600, 900].includes(sizeParam) ? sizeParam : 600;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const target = `${baseUrl}/api/qr/${campaign.slug}`;

  try {
    const pngBuffer = await QRCode.toBuffer(target, {
      type: 'png',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    const safeName = campaign.slug.replace(/[^a-z0-9-]/gi, '');
    return new NextResponse(new Uint8Array(pngBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="tixly-qr-${safeName}-${size}.png"`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('[QR PNG generation]', err);
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 });
  }

  });
}
