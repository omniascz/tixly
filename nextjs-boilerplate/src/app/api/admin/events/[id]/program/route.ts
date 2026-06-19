import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';

async function ensureOwnership(eventId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
    [eventId, promoterId],
  );
  return r.rows.length > 0;
}

const upsertSchema = z.object({
  title: z.string().max(400).optional(),
  aboutText: z.string().max(20000).optional(),
  directorNote: z.string().max(10000).optional(),
  dramaturgNote: z.string().max(10000).optional(),
  runningTimeMinutes: z.number().int().min(1).max(600).nullable().optional(),
  intermissions: z.number().int().min(0).max(10).optional(),
  language: z.string().max(10).optional(),
  contentWarnings: z.array(z.string().max(200)).max(20).optional(),
  programPriceHalire: z.number().int().min(0).max(50000_00).optional(),
  coverImageUrl: z.string().url().max(1000).nullable().optional(),
  galleryUrls: z.array(z.string().url().max(1000)).max(50).optional(),
  isPublished: z.boolean().optional(),
});

const castSchema = z.object({
  entries: z.array(
    z.object({
      artistName: z.string().min(1).max(400),
      roleName: z.string().min(1).max(400),
      artistId: z.string().uuid().optional(),
      photoUrl: z.string().url().max(1000).nullable().optional(),
      bioShort: z.string().max(2000).nullable().optional(),
      orderIndex: z.number().int().min(0).default(0),
    }),
  ).max(200),
});

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
  created_at: string;
  updated_at: string;
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

function mapProgram(p: ProgramRow, cast: CastRow[]) {
  return {
    id: p.id,
    eventId: p.event_id,
    title: p.title,
    aboutText: p.about_text,
    directorNote: p.director_note,
    dramaturgNote: p.dramaturg_note,
    runningTimeMinutes: p.running_time_minutes,
    intermissions: p.intermissions,
    language: p.language,
    contentWarnings: p.content_warnings ?? [],
    programPriceHalire: p.program_price_halire,
    coverImageUrl: p.cover_image_url,
    galleryUrls: p.gallery_urls ?? [],
    isPublished: p.is_published,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    cast: cast.map((c) => ({
      id: c.id,
      artistName: c.artist_name,
      artistId: c.artist_id,
      roleName: c.role_name,
      photoUrl: c.photo_url,
      bioShort: c.bio_short,
      orderIndex: c.order_index,
    })),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const pr = await db().query<ProgramRow>(
      `SELECT * FROM catalog.event_programs WHERE event_id = $1`,
      [params.id],
    );
    if (pr.rows.length === 0) {
      return NextResponse.json({ program: null });
    }
    const prog = pr.rows[0];

    const cr = await db().query<CastRow>(
      `SELECT * FROM catalog.program_cast_entries WHERE program_id = $1 ORDER BY order_index`,
      [prog.id],
    );

    return NextResponse.json({ program: mapProgram(prog, cr.rows) });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }
    const input = parsed.data;

    const pr = await db().query<ProgramRow>(
      `INSERT INTO catalog.event_programs
         (event_id, title, about_text, director_note, dramaturg_note,
          running_time_minutes, intermissions, language, content_warnings,
          program_price_halire, cover_image_url, gallery_urls, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (event_id) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, catalog.event_programs.title),
         about_text = COALESCE(EXCLUDED.about_text, catalog.event_programs.about_text),
         director_note = COALESCE(EXCLUDED.director_note, catalog.event_programs.director_note),
         dramaturg_note = COALESCE(EXCLUDED.dramaturg_note, catalog.event_programs.dramaturg_note),
         running_time_minutes = COALESCE(EXCLUDED.running_time_minutes, catalog.event_programs.running_time_minutes),
         intermissions = EXCLUDED.intermissions,
         language = EXCLUDED.language,
         content_warnings = EXCLUDED.content_warnings,
         program_price_halire = EXCLUDED.program_price_halire,
         cover_image_url = COALESCE(EXCLUDED.cover_image_url, catalog.event_programs.cover_image_url),
         gallery_urls = EXCLUDED.gallery_urls,
         is_published = EXCLUDED.is_published,
         updated_at = NOW()
       RETURNING *`,
      [
        params.id,
        input.title ?? null,
        input.aboutText ?? null,
        input.directorNote ?? null,
        input.dramaturgNote ?? null,
        input.runningTimeMinutes ?? null,
        input.intermissions ?? 0,
        input.language ?? 'cs',
        input.contentWarnings ?? [],
        input.programPriceHalire ?? 0,
        input.coverImageUrl ?? null,
        input.galleryUrls ?? [],
        input.isPublished ?? false,
      ],
    );

    const prog = pr.rows[0];
    const cr = await db().query<CastRow>(
      `SELECT * FROM catalog.program_cast_entries WHERE program_id = $1 ORDER BY order_index`,
      [prog.id],
    );

    return NextResponse.json({ program: mapProgram(prog, cr.rows) });
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }
    if (!(await ensureOwnership(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = castSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
    }

    const pr = await db().query<{ id: string }>(
      `SELECT id FROM catalog.event_programs WHERE event_id = $1`,
      [params.id],
    );
    if (pr.rows.length === 0) {
      return NextResponse.json({ error: 'Program does not exist yet. Create it first via POST.' }, { status: 404 });
    }
    const programId = pr.rows[0].id;

    const client = await db().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM catalog.program_cast_entries WHERE program_id = $1`,
        [programId],
      );

      const entries: CastRow[] = [];
      for (const entry of parsed.data.entries) {
        const r = await client.query<CastRow>(
          `INSERT INTO catalog.program_cast_entries
             (program_id, artist_name, artist_id, role_name, photo_url, bio_short, order_index)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            programId,
            entry.artistName,
            entry.artistId ?? null,
            entry.roleName,
            entry.photoUrl ?? null,
            entry.bioShort ?? null,
            entry.orderIndex,
          ],
        );
        entries.push(r.rows[0]);
      }

      await client.query('COMMIT');
      return NextResponse.json({
        entries: entries.map((c) => ({
          id: c.id,
          artistName: c.artist_name,
          artistId: c.artist_id,
          roleName: c.role_name,
          photoUrl: c.photo_url,
          bioShort: c.bio_short,
          orderIndex: c.order_index,
        })),
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error('[PATCH program/cast]', err);
      return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
    } finally {
      client.release();
    }
  });
}
