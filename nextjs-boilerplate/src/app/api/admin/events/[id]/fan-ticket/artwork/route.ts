/**
 * POST /api/admin/events/[id]/fan-ticket/artwork
 * Nahraje artwork (PNG/JPG/WEBP, max 8 MB) do Vercel Blob.
 * Vrátí {url} pro uložení do catalog.events.fan_artwork_url.
 */

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { runAsPromoter } from '@/lib/admin-auth';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    // Ownership check
    const own = await runWithServiceContext(() =>
      db().query(
        `SELECT id FROM catalog.events WHERE id=$1 AND promoter_id=$2 LIMIT 1`,
        [params.id, ctx.promoterId],
      ),
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const form = await req.formData().catch(() => null);
    const file = form?.get('artwork');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Field "artwork" (file) required' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG or WEBP allowed' }, { status: 415 });
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Max file size is 8 MB' }, { status: 413 });
    }

    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const filename = `fan-ticket/${params.id}/artwork.${ext}`;

    const blob = await put(filename, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    });

    // Auto-save URL to event
    await runWithServiceContext(() =>
      db().query(
        `UPDATE catalog.events SET fan_artwork_url=$1 WHERE id=$2 AND promoter_id=$3`,
        [blob.url, params.id, ctx.promoterId],
      ),
    );

    return NextResponse.json({ url: blob.url });
  });
}
