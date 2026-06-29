/**
 * GET  /api/platform/venues/[id]/seat-view-photos — list photos for venue
 * POST /api/platform/venues/[id]/seat-view-photos — upsert photo for a sector
 *
 * Platform admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { requirePlatformAdmin } from '@/lib/platform-auth';

interface PhotoRow {
  id: string;
  sector_name: string;
  photo_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  sort_order: number;
  is_360: boolean;
  embed_url: string | null;
  created_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query<PhotoRow>(
      `SELECT id, sector_name, photo_url, thumbnail_url, caption, sort_order, is_360, embed_url, created_at
         FROM catalog.seat_view_photos
        WHERE venue_id = $1
        ORDER BY sort_order, sector_name`,
      [params.id],
    );

    await client.query('COMMIT');
    return NextResponse.json({ photos: r.rows });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[GET /api/platform/venues/seat-view-photos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  let body: {
    sectorName?: string;
    photoUrl?: string;
    thumbnailUrl?: string | null;
    caption?: string | null;
    sortOrder?: number;
    is360?: boolean;
    embedUrl?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const sectorName = (body.sectorName ?? '').trim();
  const photoUrl = (body.photoUrl ?? '').trim();
  const is360 = body.is360 === true;
  const embedUrl = body.embedUrl?.trim() ?? null;
  if (!sectorName) return NextResponse.json({ error: 'MISSING_SECTOR_NAME' }, { status: 422 });
  // photo_url required for non-360; for 360 either photo_url or embed_url must be set
  if (!photoUrl && !is360) return NextResponse.json({ error: 'INVALID_PHOTO_URL' }, { status: 422 });
  if (photoUrl && !/^https?:\/\/.+/.test(photoUrl))
    return NextResponse.json({ error: 'INVALID_PHOTO_URL' }, { status: 422 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.is_platform_admin = 'true'`);

    const r = await client.query<PhotoRow>(
      `INSERT INTO catalog.seat_view_photos
         (venue_id, sector_name, photo_url, thumbnail_url, caption, sort_order, is_360, embed_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (venue_id, sector_name) DO UPDATE
         SET photo_url     = EXCLUDED.photo_url,
             thumbnail_url = EXCLUDED.thumbnail_url,
             caption       = EXCLUDED.caption,
             sort_order    = EXCLUDED.sort_order,
             is_360        = EXCLUDED.is_360,
             embed_url     = EXCLUDED.embed_url,
             updated_at    = now()
       RETURNING id, sector_name, photo_url, thumbnail_url, caption, sort_order, is_360, embed_url, created_at`,
      [
        params.id,
        sectorName,
        photoUrl || null,
        body.thumbnailUrl ?? null,
        body.caption ?? null,
        body.sortOrder ?? 0,
        is360,
        embedUrl,
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json({ photo: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST /api/platform/venues/seat-view-photos]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }
}
