/**
 * Music platform distribuce.
 *
 * Když promotér přidá umělce k akci (a umělec má bandsintown_id/songkick_id),
 * enqueue job → cron processor pošle koncert na agregátory (Bandsintown, Songkick).
 * Spotify a Apple Music se NEPOSÍLAJÍ přímo — čtou koncerty z těchto agregátorů,
 * takže se na profilu umělce objeví automaticky (s „Tickets" odkazem na Tixly).
 *
 * Bez partner API klíčů se joby přeskočí s konkrétním důvodem (ne fake).
 */
import { db } from '@/lib/db/rls-pool';
import { postBandsintownEvent } from './providers/bandsintown';
import { postSongkickEvent } from './providers/songkick';
import type { MusicEventPayload, ProviderResult } from './providers/types';

export type MusicPlatform = 'spotify' | 'bandsintown' | 'songkick' | 'apple_music';

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

function appBaseUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

/**
 * Volat po /api/admin/events/[id]/artists POST (přidání umělce k akci).
 * Vytvoří 1 job per (umělec × platforma), kde umělec má platformId.
 */
export async function enqueueMusicPosts(input: {
  artistId: string;
  eventId: string;
}): Promise<EnqueueResult> {
  const artist = await db().query<{
    name: string | null;
    spotify_id: string | null;
    bandsintown_id: string | null;
    songkick_id: string | null;
    apple_music_id: string | null;
  }>(
    `SELECT name, spotify_id, bandsintown_id, songkick_id, apple_music_id
       FROM lineups.artists WHERE id = $1`,
    [input.artistId],
  );
  if (artist.rows.length === 0) return { enqueued: 0, skipped: 0 };
  const a = artist.rows[0];

  const event = await db().query<{
    title: string;
    description: string | null;
    date_start: string;
    venue_name: string | null;
    venue_address: string | null;
    city: string | null;
    country: string | null;
    gps_lat: number | null;
    gps_lng: number | null;
  }>(
    `SELECT e.title, e.description, e.date_start::text,
            v.name AS venue_name, v.address AS venue_address, v.city, v.country,
            v.gps_lat, v.gps_lng
       FROM catalog.events e
  LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE e.id = $1`,
    [input.eventId],
  );
  if (event.rows.length === 0) return { enqueued: 0, skipped: 0 };
  const ev = event.rows[0];

  const ticketUrl = appBaseUrl() ? `${appBaseUrl()}/cs/events/${input.eventId}` : null;

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
    const payload: MusicEventPayload = {
      external_artist_id: p.id,
      artist_name: a.name,
      event_title: ev.title,
      description: ev.description,
      date_start: ev.date_start,
      venue_name: ev.venue_name,
      venue_address: ev.venue_address,
      city: ev.city,
      country: ev.country,
      lat: ev.gps_lat,
      lng: ev.gps_lng,
      ticket_url: ticketUrl,
    };
    await db().query(
      `INSERT INTO lineups.music_post_jobs (artist_id, event_id, platform, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [input.artistId, input.eventId, p.platform, JSON.stringify(payload)],
    );
    enqueued++;
  }
  return { enqueued, skipped };
}

/**
 * Routuje job na správného providera. Spotify/Apple se neposílají přímo — čtou
 * z Bandsintown/Songkick, takže se přeskočí s důvodem SYNDICATED_VIA_AGGREGATOR.
 */
async function postToplatform(
  platform: MusicPlatform,
  payload: MusicEventPayload,
): Promise<ProviderResult> {
  switch (platform) {
    case 'bandsintown':
      return postBandsintownEvent(payload);
    case 'songkick':
      return postSongkickEvent(payload);
    case 'spotify':
    case 'apple_music':
      // Tyto platformy nemají submission API — koncert se na profilu umělce objeví
      // automaticky poté, co projde na Bandsintown/Songkick.
      return { externalId: null, skipReason: 'SYNDICATED_VIA_AGGREGATOR' };
    default:
      return { externalId: null, skipReason: 'UNKNOWN_PLATFORM' };
  }
}

/**
 * Cron processor — projde pending jobs, pošle na agregátory.
 */
export async function processMusicPostQueue(maxJobs = 50): Promise<{
  processed: number;
  posted: number;
  failed: number;
  skipped: number;
}> {
  const jobs = await db().query<{
    id: string;
    platform: string;
    payload: MusicEventPayload;
  }>(
    `SELECT id, platform, payload
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
      const r = await postToplatform(job.platform as MusicPlatform, job.payload);
      if (r.externalId === null) {
        await db().query(
          `UPDATE lineups.music_post_jobs
              SET status = 'skipped', attempts = attempts + 1, last_error = $1
            WHERE id = $2`,
          [r.skipReason ?? 'SKIPPED', job.id],
        );
        results.skipped++;
      } else {
        await db().query(
          `UPDATE lineups.music_post_jobs
              SET status = 'posted', external_post_id = $1, posted_at = now()
            WHERE id = $2`,
          [r.externalId, job.id],
        );
        results.posted++;
      }
    } catch (e) {
      await db().query(
        `UPDATE lineups.music_post_jobs
            SET status = 'failed', attempts = attempts + 1, last_error = $1
          WHERE id = $2`,
        [(e as Error).message.slice(0, 500), job.id],
      );
      results.failed++;
    }
  }

  return results;
}
