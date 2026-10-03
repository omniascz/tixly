/**
 * POST /api/buyer/spotify/connect — mock-mode connect Spotify
 *
 * Bez SPOTIFY_CLIENT_ID env → vrátí mock connection se seedovými top artists.
 * V produkci by místo toho vrátil OAuth authorize URL pro redirect.
 *
 * Body (mock only): { mockArtists?: string[] } — pokud chybí, použije default
 * smíšený seed (klasika + rock + dance pro různé event matches).
 *
 * DACH parity #P2-3 (DICE Spotify Concerts API pattern).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';
import {
  buildAuthorizeUrl,
  generatePkce,
  getSpotifyConfig,
} from '@/lib/spotify/oauth';


const schema = z.object({
  mockArtists: z.array(z.string().min(1).max(120)).max(50).optional(),
  mockGenres: z.array(z.string()).max(20).optional(),
});

function isMockMode(): boolean {
  return !process.env.SPOTIFY_CLIENT_ID;
}

const DEFAULT_MOCK_ARTISTS: Array<{ name: string; genres: string[] }> = [
  { name: 'Tata Bojs', genres: ['indie rock', 'czech rock', 'alternative'] },
  { name: 'Lake Malawi', genres: ['indie pop', 'czech pop'] },
  { name: 'Mig 21', genres: ['czech pop', 'rock'] },
  { name: 'Vojtěch Dyk', genres: ['jazz', 'swing', 'czech vocal'] },
  { name: 'Aneta Langerová', genres: ['czech pop', 'pop vocal'] },
];

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_BODY', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  if (!isMockMode()) {
    // Production OAuth: PKCE + Authorization Code Flow.
    // Vygenerujeme verifier + state, uložíme do marketing.spotify_oauth_pending,
    // vrátíme authorize URL pro client-side redirect.
    const cfg = getSpotifyConfig();
    if (!cfg) {
      return NextResponse.json(
        { error: 'CONFIG_MISSING', message: 'SPOTIFY_CLIENT_SECRET chybí' },
        { status: 500 },
      );
    }
    const pkce = generatePkce();
    const client = await db().connect();
    try {
      await client.query('BEGIN');
      // Kolo 3: kontext kupce — RLS pokrývá jeho vlastní řádky; admin eskalace odstraněna.
      await client.query(
        `INSERT INTO marketing.spotify_oauth_pending
           (state, user_id, code_verifier)
         VALUES ($1, $2, $3)`,
        [pkce.state, userId, pkce.verifier],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    return NextResponse.json({
      ok: true,
      isMock: false,
      authorizeUrl: buildAuthorizeUrl(cfg, pkce),
      state: pkce.state,
    });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: kontext kupce — RLS pokrývá jeho vlastní řádky; admin eskalace odstraněna.

    // Upsert connection (mock)
    await client.query(
      `INSERT INTO marketing.user_spotify_connections
         (user_id, spotify_display_name, is_mock, last_sync_at, connected_at)
       VALUES ($1, $2, true, NOW(), NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET spotify_display_name = EXCLUDED.spotify_display_name,
             is_mock = true,
             last_sync_at = NOW()`,
      [userId, `Mock User ${userId.slice(0, 6)}`],
    );

    // Wipe & re-seed top artists
    await client.query(
      `DELETE FROM marketing.user_top_artists WHERE user_id = $1`,
      [userId],
    );

    const seed =
      parsed.data.mockArtists && parsed.data.mockArtists.length > 0
        ? parsed.data.mockArtists.map((name, i) => ({
            name,
            genres: parsed.data.mockGenres ?? [],
            rank: i + 1,
          }))
        : DEFAULT_MOCK_ARTISTS.map((a, i) => ({ ...a, rank: i + 1 }));

    for (const a of seed) {
      await client.query(
        `INSERT INTO marketing.user_top_artists
           (user_id, artist_name, genres, rank, synced_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT DO NOTHING`,
        [userId, a.name, a.genres, a.rank],
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      isMock: true,
      displayName: `Mock User ${userId.slice(0, 6)}`,
      topArtistsSynced: seed.length,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[POST spotify/connect]', err);
    return NextResponse.json({ error: 'INTERNAL' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: kontext kupce — RLS pokrývá jeho vlastní řádky; admin eskalace odstraněna.

    const conn = await client.query<{
      spotify_display_name: string | null;
      is_mock: boolean;
      connected_at: string;
      last_sync_at: string | null;
    }>(
      `SELECT spotify_display_name, is_mock, connected_at::text, last_sync_at::text
         FROM marketing.user_spotify_connections
        WHERE user_id = $1`,
      [userId],
    );

    if (conn.rows.length === 0) {
      await client.query('COMMIT');
      return NextResponse.json({ connected: false, isMock: isMockMode() });
    }

    const top = await client.query<{ artist_name: string; rank: number; genres: string[] }>(
      `SELECT artist_name, rank, genres
         FROM marketing.user_top_artists
        WHERE user_id = $1
        ORDER BY rank
        LIMIT 20`,
      [userId],
    );
    await client.query('COMMIT');

    return NextResponse.json({
      connected: true,
      isMock: conn.rows[0].is_mock,
      displayName: conn.rows[0].spotify_display_name,
      connectedAt: conn.rows[0].connected_at,
      lastSyncAt: conn.rows[0].last_sync_at,
      topArtists: top.rows.map((r) => ({
        name: r.artist_name,
        rank: r.rank,
        genres: r.genres,
      })),
    });
  } finally {
    client.release();
  }

  });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    // Kolo 3: kontext kupce — RLS pokrývá jeho vlastní řádky; admin eskalace odstraněna.
    await client.query(
      `DELETE FROM marketing.user_spotify_connections WHERE user_id = $1`,
      [userId],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } finally {
    client.release();
  }

  });
}
