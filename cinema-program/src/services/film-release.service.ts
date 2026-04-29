import { CinemaProgramError } from '../lib/cinema-program-errors';
import type { CinemaProgramDB } from './age-restriction.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReleaseStatus = 'coming_soon' | 'now_showing' | 'ended';

export interface FilmReleaseInput {
  releaseDate: string;
  endDate?: string | null;
  status?: ReleaseStatus;
  posterOverrideUrl?: string | null;
  promoText?: string | null;
}

export interface FilmRelease {
  id: string;
  filmId: string;
  venueId: string;
  releaseDate: string;
  endDate: string | null;
  status: ReleaseStatus;
  posterOverrideUrl: string | null;
  promoText: string | null;
}

export interface FilmReleaseWithFilm extends FilmRelease {
  filmTitle: string;
  filmRating: string | null;
  filmDurationMinutes: number;
  filmGenre: string | null;
  filmPosterUrl: string | null;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface ReleaseRow {
  id: string;
  film_id: string;
  venue_id: string;
  release_date: string;
  end_date: string | null;
  status: ReleaseStatus;
  poster_override_url: string | null;
  promo_text: string | null;
}

interface ReleaseWithFilmRow extends ReleaseRow {
  film_title: string;
  film_rating: string | null;
  film_duration_minutes: number;
  film_genre: string | null;
  film_poster_url: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRelease(row: ReleaseRow): FilmRelease {
  return {
    id: row.id,
    filmId: row.film_id,
    venueId: row.venue_id,
    releaseDate: row.release_date,
    endDate: row.end_date,
    status: row.status,
    posterOverrideUrl: row.poster_override_url,
    promoText: row.promo_text,
  };
}

function mapReleaseWithFilm(row: ReleaseWithFilmRow): FilmReleaseWithFilm {
  return {
    ...mapRelease(row),
    filmTitle: row.film_title,
    filmRating: row.film_rating,
    filmDurationMinutes: row.film_duration_minutes,
    filmGenre: row.film_genre,
    filmPosterUrl: row.film_poster_url,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function setRelease(
  filmId: string,
  venueId: string,
  input: FilmReleaseInput,
  db: CinemaProgramDB,
): Promise<FilmRelease> {
  const { rows } = await db.query<ReleaseRow>(
    `INSERT INTO cinema.film_releases
       (film_id, venue_id, release_date, end_date, status, poster_override_url, promo_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (film_id, venue_id) DO UPDATE SET
       release_date = EXCLUDED.release_date,
       end_date = EXCLUDED.end_date,
       status = EXCLUDED.status,
       poster_override_url = EXCLUDED.poster_override_url,
       promo_text = EXCLUDED.promo_text
     RETURNING *`,
    [
      filmId,
      venueId,
      input.releaseDate,
      input.endDate ?? null,
      input.status ?? 'coming_soon',
      input.posterOverrideUrl ?? null,
      input.promoText ?? null,
    ],
  );

  if (!rows[0]) {
    throw new CinemaProgramError('RELEASE_NOT_FOUND');
  }

  return mapRelease(rows[0]);
}

export async function getRelease(
  filmId: string,
  venueId: string,
  db: CinemaProgramDB,
): Promise<FilmRelease> {
  const { rows } = await db.query<ReleaseRow>(
    `SELECT * FROM cinema.film_releases
     WHERE film_id = $1 AND venue_id = $2`,
    [filmId, venueId],
  );

  if (!rows[0]) {
    throw new CinemaProgramError('RELEASE_NOT_FOUND');
  }

  return mapRelease(rows[0]);
}

export async function listNowShowing(
  venueId: string,
  db: CinemaProgramDB,
): Promise<FilmReleaseWithFilm[]> {
  const { rows } = await db.query<ReleaseWithFilmRow>(
    `SELECT fr.*,
            f.title AS film_title,
            f.rating AS film_rating,
            f.duration_minutes AS film_duration_minutes,
            f.genre AS film_genre,
            f.poster_url AS film_poster_url
     FROM cinema.film_releases fr
     JOIN cinema.films f ON f.id = fr.film_id
     WHERE fr.venue_id = $1 AND fr.status = 'now_showing'
     ORDER BY fr.release_date ASC`,
    [venueId],
  );

  return rows.map(mapReleaseWithFilm);
}

export async function listComingSoon(
  venueId: string,
  db: CinemaProgramDB,
): Promise<FilmReleaseWithFilm[]> {
  const { rows } = await db.query<ReleaseWithFilmRow>(
    `SELECT fr.*,
            f.title AS film_title,
            f.rating AS film_rating,
            f.duration_minutes AS film_duration_minutes,
            f.genre AS film_genre,
            f.poster_url AS film_poster_url
     FROM cinema.film_releases fr
     JOIN cinema.films f ON f.id = fr.film_id
     WHERE fr.venue_id = $1 AND fr.status = 'coming_soon'
     ORDER BY fr.release_date ASC`,
    [venueId],
  );

  return rows.map(mapReleaseWithFilm);
}

export async function updateReleaseStatus(
  filmId: string,
  venueId: string,
  status: ReleaseStatus,
  db: CinemaProgramDB,
): Promise<FilmRelease> {
  const { rows } = await db.query<ReleaseRow>(
    `UPDATE cinema.film_releases
     SET status = $1
     WHERE film_id = $2 AND venue_id = $3
     RETURNING *`,
    [status, filmId, venueId],
  );

  if (!rows[0]) {
    throw new CinemaProgramError('RELEASE_NOT_FOUND');
  }

  return mapRelease(rows[0]);
}

export async function autoUpdateReleaseStatuses(
  venueId: string,
  db: CinemaProgramDB,
): Promise<{ updated: number }> {
  // Mark ended: end_date < TODAY
  const { rows: endedRows } = await db.query<{ count: string }>(
    `UPDATE cinema.film_releases
     SET status = 'ended'
     WHERE venue_id = $1
       AND end_date IS NOT NULL
       AND end_date < CURRENT_DATE
       AND status != 'ended'
     RETURNING id`,
    [venueId],
  );

  // Mark now_showing: release_date <= TODAY and not ended
  const { rows: showingRows } = await db.query<{ id: string }>(
    `UPDATE cinema.film_releases
     SET status = 'now_showing'
     WHERE venue_id = $1
       AND release_date <= CURRENT_DATE
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       AND status = 'coming_soon'
     RETURNING id`,
    [venueId],
  );

  return { updated: endedRows.length + showingRows.length };
}
