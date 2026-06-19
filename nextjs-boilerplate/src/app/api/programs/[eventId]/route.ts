import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

interface ProgramRow {
  id: string;
  event_id: string;
  title: string | null;
  about_text: string | null;
  director_note: string | null;
  dramaturg_note: string | null;
  running_time_minutes: number | null;
  intermissions: number;
  language: string;
  content_warnings: string[] | null;
  program_price_halire: number;
  cover_image_url: string | null;
  gallery_urls: string[] | null;
  is_published: boolean;
}

interface CastRow {
  id: string;
  program_id: string;
  artist_name: string;
  artist_id: string | null;
  role_name: string;
  photo_url: string | null;
  bio_short: string | null;
  order_index: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<Response> {
  const { eventId } = params;
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  const accessToken = req.nextUrl.searchParams.get('accessToken');

  const pr = await db().query<ProgramRow>(
    `SELECT * FROM catalog.event_programs
     WHERE event_id = $1 AND is_published = true`,
    [eventId],
  );

  if (pr.rows.length === 0) {
    return NextResponse.json({ program: null }, { status: 404 });
  }

  const prog = pr.rows[0];
  const priceHalire = prog.program_price_halire;

  if (priceHalire === 0) {
    const cr = await db().query<CastRow>(
      `SELECT * FROM catalog.program_cast_entries
       WHERE program_id = $1 ORDER BY order_index`,
      [prog.id],
    );
    return NextResponse.json({
      locked: false,
      program: {
        id: prog.id,
        title: prog.title,
        aboutText: prog.about_text,
        directorNote: prog.director_note,
        dramaturgNote: prog.dramaturg_note,
        runningTimeMinutes: prog.running_time_minutes,
        intermissions: prog.intermissions,
        language: prog.language,
        contentWarnings: prog.content_warnings ?? [],
        programPriceHalire: 0,
        coverImageUrl: prog.cover_image_url,
        galleryUrls: prog.gallery_urls ?? [],
        cast: cr.rows.map((c) => ({
          id: c.id,
          artistName: c.artist_name,
          artistId: c.artist_id,
          roleName: c.role_name,
          photoUrl: c.photo_url,
          bioShort: c.bio_short,
          orderIndex: c.order_index,
        })),
      },
    });
  }

  if (accessToken) {
    const tokenCheck = await db().query<{ id: string }>(
      `SELECT pp.id
       FROM orders.program_purchases pp
       WHERE pp.access_token = $1 AND pp.program_id = $2
       LIMIT 1`,
      [accessToken, prog.id],
    );

    if (tokenCheck.rows.length > 0) {
      const cr = await db().query<CastRow>(
        `SELECT * FROM catalog.program_cast_entries
         WHERE program_id = $1 ORDER BY order_index`,
        [prog.id],
      );
      return NextResponse.json({
        locked: false,
        program: {
          id: prog.id,
          title: prog.title,
          aboutText: prog.about_text,
          directorNote: prog.director_note,
          dramaturgNote: prog.dramaturg_note,
          runningTimeMinutes: prog.running_time_minutes,
          intermissions: prog.intermissions,
          language: prog.language,
          contentWarnings: prog.content_warnings ?? [],
          programPriceHalire: priceHalire,
          coverImageUrl: prog.cover_image_url,
          galleryUrls: prog.gallery_urls ?? [],
          cast: cr.rows.map((c) => ({
            id: c.id,
            artistName: c.artist_name,
            artistId: c.artist_id,
            roleName: c.role_name,
            photoUrl: c.photo_url,
            bioShort: c.bio_short,
            orderIndex: c.order_index,
          })),
        },
      });
    }
  }

  return NextResponse.json({
    locked: true,
    program: {
      id: prog.id,
      title: prog.title,
      coverImageUrl: prog.cover_image_url,
      programPriceHalire: priceHalire,
    },
  });
}
