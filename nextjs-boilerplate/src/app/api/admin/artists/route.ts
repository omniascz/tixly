/**
 * GET  /api/admin/artists     — list artists promotéra
 * POST /api/admin/artists     — create artist
 *
 * TM Parity Fáze 2 — Attraction & Artist Management.
 * Artist můžou být sdíleny napříč events (festival lineup, tour).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]{2,80}$/).optional(),
  bio: z.string().max(5000).optional(),
  coverImageUrl: z.string().url().optional(),
  genres: z.array(z.string().max(50)).max(10).optional(),
  country: z.string().length(2).optional(),
  websiteUrl: z.string().url().optional(),
  socialLinks: z.record(z.string()).optional(),
  spotifyId: z.string().max(50).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{
    id: string;
    name: string;
    slug: string | null;
    bio: string | null;
    cover_image_url: string | null;
    genres: string[];
    country: string | null;
    event_count: string;
  }>(
    `SELECT a.id, a.name, a.slug, a.bio, a.cover_image_url, a.genres, a.country,
            (SELECT COUNT(*)::text FROM lineups.event_artists WHERE artist_id = a.id) AS event_count
       FROM lineups.artists a
      WHERE a.promoter_id = $1
      ORDER BY a.name ASC
      LIMIT 500`,
    [promoter.promoterId],
  );

  return NextResponse.json({ artists: r.rows });

  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });
  }
  const d = parsed.data;

  const r = await db().query<{ id: string }>(
    `INSERT INTO lineups.artists
       (promoter_id, name, slug, bio, cover_image_url, genres, country, website_url, social_links, spotify_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     RETURNING id`,
    [
      promoter.promoterId, d.name, d.slug ?? null,
      d.bio ?? null, d.coverImageUrl ?? null,
      d.genres ?? [], d.country ?? null,
      d.websiteUrl ?? null,
      d.socialLinks ? JSON.stringify(d.socialLinks) : '{}',
      d.spotifyId ?? null,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });

  });
}
