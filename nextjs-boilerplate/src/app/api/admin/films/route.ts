/**
 * GET  /api/admin/films  — seznam filmů promotéra
 * POST /api/admin/films  — přidat film do katalogu
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await db().query(
      `SELECT id, title, original_title, poster_url, duration_minutes,
              age_rating, genre, director, language, release_year, status,
              created_at
       FROM catalog.films
       WHERE promoter_id = $1 OR promoter_id IS NULL
       ORDER BY created_at DESC
       LIMIT 200`,
      [ctx.promoterId],
    );
    return NextResponse.json({ films: r.rows });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as {
      title: string;
      original_title?: string;
      synopsis?: string;
      poster_url?: string;
      backdrop_url?: string;
      trailer_url?: string;
      duration_minutes: number;
      age_rating?: string;
      genre?: string[];
      director?: string;
      cast_main?: string;
      language?: string;
      original_language?: string;
      country?: string;
      release_year?: number;
      imdb_id?: string;
      distributor?: string;
    };

    if (!b.title?.trim()) {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }
    if (!b.duration_minutes || b.duration_minutes < 1) {
      return NextResponse.json({ error: 'duration_minutes required' }, { status: 400 });
    }

    const r = await db().query(
      `INSERT INTO catalog.films
         (promoter_id, title, original_title, synopsis, poster_url, backdrop_url,
          trailer_url, duration_minutes, age_rating, genre, director, cast_main,
          language, original_language, country, release_year, imdb_id, distributor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        ctx.promoterId,
        b.title.trim(),
        b.original_title?.trim() ?? null,
        b.synopsis?.trim() ?? null,
        b.poster_url ?? null,
        b.backdrop_url ?? null,
        b.trailer_url ?? null,
        b.duration_minutes,
        b.age_rating ?? 'U',
        b.genre ?? [],
        b.director?.trim() ?? null,
        b.cast_main?.trim() ?? null,
        b.language ?? 'cs',
        b.original_language ?? null,
        b.country ?? null,
        b.release_year ?? null,
        b.imdb_id?.trim() ?? null,
        b.distributor?.trim() ?? null,
      ],
    );

    return NextResponse.json({ film: r.rows[0] }, { status: 201 });
  });
}
