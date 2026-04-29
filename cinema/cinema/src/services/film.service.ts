import { CinemaError } from '../lib/cinema-errors';
import type { CinemaDB } from './venue.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilmInput {
  title: string;
  originalTitle?: string;
  synopsis?: string;
  durationMinutes: number;
  language?: string;
  subtitles?: string;
  genre?: string;
  director?: string;
  castList?: string[];
  posterUrl?: string;
  trailerUrl?: string;
  imdbId?: string;
  releaseYear?: number;
  rating?: string;
}

export interface FilmUpdateInput {
  title?: string;
  originalTitle?: string;
  synopsis?: string;
  durationMinutes?: number;
  language?: string;
  subtitles?: string;
  genre?: string;
  director?: string;
  castList?: string[];
  posterUrl?: string;
  trailerUrl?: string;
  releaseYear?: number;
  rating?: string;
}

export interface FilmFilters {
  genre?: string;
  language?: string;
  rating?: string;
}

export interface Film {
  id: string;
  promoterId: string;
  title: string;
  originalTitle: string | null;
  synopsis: string | null;
  durationMinutes: number;
  language: string;
  subtitles: string | null;
  genre: string | null;
  director: string | null;
  castList: string[];
  posterUrl: string | null;
  trailerUrl: string | null;
  imdbId: string | null;
  releaseYear: number | null;
  rating: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createFilm(
  promoterId: string,
  input: FilmInput,
  db: CinemaDB,
): Promise<Film> {
  const { rows } = await db.query<FilmRow>(
    `INSERT INTO cinema.films
       (promoter_id, title, original_title, synopsis, duration_minutes,
        language, subtitles, genre, director, cast_list,
        poster_url, trailer_url, imdb_id, release_year, rating)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      promoterId,
      input.title,
      input.originalTitle ?? null,
      input.synopsis ?? null,
      input.durationMinutes,
      input.language ?? 'cs',
      input.subtitles ?? null,
      input.genre ?? null,
      input.director ?? null,
      input.castList ?? [],
      input.posterUrl ?? null,
      input.trailerUrl ?? null,
      input.imdbId ?? null,
      input.releaseYear ?? null,
      input.rating ?? null,
    ],
  );

  if (!rows[0]) {
    throw new CinemaError('FILM_DUPLICATE');
  }

  return mapFilm(rows[0]);
}

export async function getFilm(filmId: string, db: CinemaDB): Promise<Film> {
  const { rows } = await db.query<FilmRow>(
    `SELECT * FROM cinema.films WHERE id = $1`,
    [filmId],
  );

  if (!rows[0]) {
    throw new CinemaError('FILM_NOT_FOUND');
  }

  return mapFilm(rows[0]);
}

export async function listFilms(
  promoterId: string,
  filters: FilmFilters,
  db: CinemaDB,
): Promise<Film[]> {
  const conditions: string[] = ['promoter_id = $1'];
  const params: unknown[] = [promoterId];
  let idx = 2;

  if (filters.genre) {
    conditions.push(`genre = $${idx}`);
    params.push(filters.genre);
    idx++;
  }

  if (filters.language) {
    conditions.push(`language = $${idx}`);
    params.push(filters.language);
    idx++;
  }

  if (filters.rating) {
    conditions.push(`rating = $${idx}`);
    params.push(filters.rating);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await db.query<FilmRow>(
    `SELECT * FROM cinema.films ${where} ORDER BY title ASC`,
    params,
  );

  return rows.map(mapFilm);
}

export async function updateFilm(
  filmId: string,
  input: FilmUpdateInput,
  db: CinemaDB,
): Promise<Film> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.title !== undefined) { sets.push(`title = $${idx}`); params.push(input.title); idx++; }
  if (input.originalTitle !== undefined) { sets.push(`original_title = $${idx}`); params.push(input.originalTitle); idx++; }
  if (input.synopsis !== undefined) { sets.push(`synopsis = $${idx}`); params.push(input.synopsis); idx++; }
  if (input.durationMinutes !== undefined) { sets.push(`duration_minutes = $${idx}`); params.push(input.durationMinutes); idx++; }
  if (input.language !== undefined) { sets.push(`language = $${idx}`); params.push(input.language); idx++; }
  if (input.subtitles !== undefined) { sets.push(`subtitles = $${idx}`); params.push(input.subtitles); idx++; }
  if (input.genre !== undefined) { sets.push(`genre = $${idx}`); params.push(input.genre); idx++; }
  if (input.director !== undefined) { sets.push(`director = $${idx}`); params.push(input.director); idx++; }
  if (input.castList !== undefined) { sets.push(`cast_list = $${idx}`); params.push(input.castList); idx++; }
  if (input.posterUrl !== undefined) { sets.push(`poster_url = $${idx}`); params.push(input.posterUrl); idx++; }
  if (input.trailerUrl !== undefined) { sets.push(`trailer_url = $${idx}`); params.push(input.trailerUrl); idx++; }
  if (input.releaseYear !== undefined) { sets.push(`release_year = $${idx}`); params.push(input.releaseYear); idx++; }
  if (input.rating !== undefined) { sets.push(`rating = $${idx}`); params.push(input.rating); idx++; }

  params.push(filmId);

  const { rows } = await db.query<FilmRow>(
    `UPDATE cinema.films SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CinemaError('FILM_NOT_FOUND');
  }

  return mapFilm(rows[0]);
}

export async function searchFilms(
  promoterId: string,
  query: string,
  db: CinemaDB,
): Promise<Film[]> {
  const { rows } = await db.query<FilmRow>(
    `SELECT * FROM cinema.films
     WHERE promoter_id = $1
       AND (title ILIKE $2 OR original_title ILIKE $2)
     ORDER BY title ASC`,
    [promoterId, `%${query}%`],
  );

  return rows.map(mapFilm);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FilmRow {
  id: string;
  promoter_id: string;
  title: string;
  original_title: string | null;
  synopsis: string | null;
  duration_minutes: number;
  language: string;
  subtitles: string | null;
  genre: string | null;
  director: string | null;
  cast_list: string[];
  poster_url: string | null;
  trailer_url: string | null;
  imdb_id: string | null;
  release_year: number | null;
  rating: string | null;
  created_at: string;
}

function mapFilm(row: FilmRow): Film {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    title: row.title,
    originalTitle: row.original_title,
    synopsis: row.synopsis,
    durationMinutes: row.duration_minutes,
    language: row.language,
    subtitles: row.subtitles,
    genre: row.genre,
    director: row.director,
    castList: row.cast_list ?? [],
    posterUrl: row.poster_url,
    trailerUrl: row.trailer_url,
    imdbId: row.imdb_id,
    releaseYear: row.release_year,
    rating: row.rating,
    createdAt: row.created_at,
  };
}
