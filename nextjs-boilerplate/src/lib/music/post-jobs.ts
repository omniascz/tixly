/**
 * Music platform auto-post jobs.
 *
 * Když promotér přidá artist k eventu a artist má spotify_id/bandsintown_id,
 * enqueue jobs do lineups.music_post_jobs. Cron processor pošle.
 *
 * Skeleton — production by routovala přes Spotify API, Bandsintown Partner API.
 * Without API credentials vrátí 'skipped'.
 */
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export type MusicPlatform = 'spotify' | 'bandsintown' | 'songkick' | 'apple_music';

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

/**
 * Volat po /api/admin/events/[id]/artists POST (přidání artist k eventu).
 * Vytvoří 1 job per (artist × platform) pokud artist má platformId.
 */
export async function enqueueMusicPosts(input: {
  artistId: string;
  eventId: string;
}): Promise<EnqueueResult> {
  const artist = await db().query<{
    spotify_id: string | null;
    bandsintown_id: string | null;
    songkick_id: string | null;
    apple_music_id: string | null;
  }>(
    `SELECT spotify_id, bandsintown_id, songkick_id, apple_music_id
       FROM lineups.artists WHERE id = $1`,
    [input.artistId],
  );

  if (artist.rows.length === 0) return { enqueued: 0, skipped: 0 };
  const a = artist.rows[0];

  const event = await db().query<{
    title: string;
    date_start: string;
    venue_name: string | null;
    city: string | null;
  }>(
    `SELECT e.title, e.date_start::text, v.name AS venue_name, v.city
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE e.id = $1`,
    [input.eventId],
  );
  if (event.rows.length === 0) return { enqueued: 0, skipped: 0 };
  const ev = event.rows[0];

  const platforms: { id: string | null; platform: MusicPlatform }[] = [
    { id: a.spotify_id, platform: 'spotify' },
    { id: a.bandsintown_id, platform: 'bandsintown' },
    { id: a.songkick_id, platform: 'songkick' },
    { id: a.apple_music_id, platform: 'apple_music' },
  ];

  let enqueued = 0;
  let skipped = 0;

  for (const p of platforms) {
    if (!p.id) { skipped++; continue; }

    await db().query(
      `INSERT INTO lineups.music_post_jobs (artist_id, event_id, platform, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        input.artistId, input.eventId, p.platform,
        JSON.stringify({
          external_artist_id: p.id,
          event_title: ev.title,
          date_start: ev.date_start,
          venue_name: ev.venue_name,
          city: ev.city,
        }),
      ],
    );
    enqueued++;
  }

  return { enqueued, skipped };
}

/**
 * Cron processor — projde pending jobs, posílá na external APIs.
 */
export async function processMusicPostQueue(maxJobs = 50): Promise<{
  processed: number;
  posted: number;
  failed: number;
  skipped: number;
}> {
  const jobs = await db().query<{
    id: string;
    artist_id: string;
    event_id: string;
    platform: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT id, artist_id, event_id, platform, payload
       FROM lineups.music_post_jobs
      WHERE status = 'pending' AND attempts < 3
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [maxJobs],
  );

  const results = { processed: 0, posted: 0, failed: 0, skipped: 0 };

  for (const job of jobs.rows) {
    results.processed++;
    try {
      const externalId = await postToplatform(job.platform as MusicPlatform, job.payload);
      if (externalId === null) {
        await db().query(
          `UPDATE lineups.music_post_jobs
              SET status = 'skipped', attempts = attempts + 1,
                  last_error = 'API_KEY_MISSING'
            WHERE id = $1`,
          [job.id],
        );
        results.skipped++;
      } else {
        await db().query(
          `UPDATE lineups.music_post_jobs
              SET status = 'posted', external_post_id = $1, posted_at = now()
            WHERE id = $2`,
          [externalId, job.id],
        );
        results.posted++;
      }
    } catch (e) {
      await db().query(
        `UPDATE lineups.music_post_jobs
            SET status = 'failed', attempts = attempts + 1,
                last_error = $1
          WHERE id = $2`,
        [(e as Error).message.slice(0, 500), job.id],
      );
      results.failed++;
    }
  }

  return results;
}

async function postToplatform(platform: MusicPlatform, _payload: Record<string, unknown>): Promise<string | null> {
  // Production: routovat na Spotify / Bandsintown / Songkick API.
  // Bez API klíčů vrátíme null = SKIP.
  const apiKey = process.env[`${platform.toUpperCase()}_API_KEY`];
  if (!apiKey) return null;

  // Skeleton: would call platform-specific endpoint
  return `mock-${platform}-${Date.now()}`;
}
