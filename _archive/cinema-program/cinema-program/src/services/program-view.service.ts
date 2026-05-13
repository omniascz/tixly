import { CinemaProgramError } from '../lib/cinema-program-errors';
import type { CinemaProgramDB } from './age-restriction.service';
import { getWidgetConfig } from './widget-config.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublicScreening {
  id: string;
  film: {
    id: string;
    title: string;
    rating: string | null;
    durationMinutes: number;
    posterUrl: string | null;
    genre: string | null;
  };
  auditorium: {
    id: string;
    name: string;
  };
  startsAt: string;
  endsAt: string;
  format: string | null;
  language: string | null;
  subtitles: string | null;
  priceHellers: number | null;
  seatsAvailable: number;
  tags: string[];
  status: string;
}

export interface ProgramDay {
  date: string;
  screenings: PublicScreening[];
}

export interface PublicProgram {
  venue: {
    id: string;
    name: string;
    city: string | null;
  };
  days: ProgramDay[];
}

export interface NowShowingFilm {
  filmId: string;
  title: string;
  rating: string | null;
  durationMinutes: number;
  posterUrl: string | null;
  genre: string | null;
  nextScreeningAt: string | null;
  releaseDate: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface VenueRow {
  id: string;
  name: string;
  city: string | null;
}

interface ScreeningJoinRow {
  id: string;
  film_id: string;
  film_title: string;
  film_rating: string | null;
  film_duration_minutes: number;
  film_poster_url: string | null;
  film_genre: string | null;
  auditorium_id: string;
  auditorium_name: string;
  starts_at: string;
  ends_at: string;
  format: string | null;
  language: string | null;
  subtitles: string | null;
  price_hellers: number;
  total_seats: number;
  seats_sold: number;
  status: string;
}

interface ScreeningTagRow {
  screening_id: string;
  tag: string;
}

interface NowShowingRow {
  film_id: string;
  film_title: string;
  film_rating: string | null;
  film_duration_minutes: number;
  film_poster_url: string | null;
  film_genre: string | null;
  release_date: string;
  next_screening_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateOnlyStr(isoString: string): string {
  return isoString.slice(0, 10);
}

function groupScreeningsByDay(screenings: PublicScreening[]): ProgramDay[] {
  const dayMap = new Map<string, PublicScreening[]>();

  for (const s of screenings) {
    const day = dateOnlyStr(s.startsAt);
    if (!dayMap.has(day)) {
      dayMap.set(day, []);
    }
    dayMap.get(day)!.push(s);
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scs]) => ({ date, screenings: scs }));
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * getPublicProgram
 * Query 1: venue info
 * Query 2: screenings with JOINs (film, auditorium)
 * Query 3: tags for those screenings
 */
export async function getPublicProgram(
  venueId: string,
  dateFrom: string,
  dateTo: string,
  db: CinemaProgramDB,
): Promise<PublicProgram> {
  // Query 1: venue
  const { rows: venueRows } = await db.query<VenueRow>(
    `SELECT id, name, city FROM cinema.venues WHERE id = $1`,
    [venueId],
  );

  const venue = venueRows[0];
  if (!venue) {
    return {
      venue: { id: venueId, name: '', city: null },
      days: [],
    };
  }

  // Query 2: screenings in date range
  const { rows: screeningRows } = await db.query<ScreeningJoinRow>(
    `SELECT
       s.id,
       s.film_id,
       f.title AS film_title,
       f.rating AS film_rating,
       f.duration_minutes AS film_duration_minutes,
       f.poster_url AS film_poster_url,
       f.genre AS film_genre,
       a.id AS auditorium_id,
       a.name AS auditorium_name,
       s.starts_at,
       s.ends_at,
       s.format,
       s.language,
       s.subtitles,
       s.price_hellers,
       s.total_seats,
       s.seats_sold,
       s.status
     FROM cinema.screenings s
     JOIN cinema.films f ON f.id = s.film_id
     JOIN cinema.auditoriums a ON a.id = s.auditorium_id
     WHERE a.venue_id = $1
       AND s.starts_at >= $2
       AND s.starts_at <= $3
       AND s.status != 'cancelled'
     ORDER BY s.starts_at ASC`,
    [venueId, dateFrom, dateTo],
  );

  if (screeningRows.length === 0) {
    return {
      venue: { id: venue.id, name: venue.name, city: venue.city },
      days: [],
    };
  }

  const screeningIds = screeningRows.map((r) => r.id);

  // Query 3: tags for all screenings
  const { rows: tagRows } = await db.query<ScreeningTagRow>(
    `SELECT screening_id, tag FROM cinema.screening_tags
     WHERE screening_id = ANY($1)
     ORDER BY tag ASC`,
    [screeningIds],
  );

  // Build tag lookup
  const tagsByScreening = new Map<string, string[]>();
  for (const t of tagRows) {
    if (!tagsByScreening.has(t.screening_id)) {
      tagsByScreening.set(t.screening_id, []);
    }
    tagsByScreening.get(t.screening_id)!.push(t.tag);
  }

  const publicScreenings: PublicScreening[] = screeningRows.map((row) => ({
    id: row.id,
    film: {
      id: row.film_id,
      title: row.film_title,
      rating: row.film_rating,
      durationMinutes: row.film_duration_minutes,
      posterUrl: row.film_poster_url,
      genre: row.film_genre,
    },
    auditorium: {
      id: row.auditorium_id,
      name: row.auditorium_name,
    },
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    format: row.format,
    language: row.language,
    subtitles: row.subtitles,
    priceHellers: row.price_hellers,
    seatsAvailable: Math.max(0, row.total_seats - row.seats_sold),
    tags: tagsByScreening.get(row.id) ?? [],
    status: row.status,
  }));

  return {
    venue: { id: venue.id, name: venue.name, city: venue.city },
    days: groupScreeningsByDay(publicScreenings),
  };
}

/**
 * getWidgetData
 * Query 1 (from getWidgetConfig): widget_configs
 * Then calls getPublicProgram (queries 2, 3, 4)
 * Applies filters from config.
 */
export async function getWidgetData(
  venueId: string,
  configKey: string,
  db: CinemaProgramDB,
): Promise<PublicProgram> {
  const config = await getWidgetConfig(venueId, configKey, db);

  const dateFrom = new Date();
  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() + config.daysAhead);

  const program = await getPublicProgram(
    venueId,
    dateFrom.toISOString(),
    dateTo.toISOString(),
    db,
  );

  // Apply filters
  const filteredDays = program.days.map((day) => {
    let screenings = day.screenings;

    // Filter out sold-out screenings if config says so
    if (!config.showSoldOut) {
      screenings = screenings.filter((s) => s.status !== 'sold_out' && s.seatsAvailable > 0);
    }

    // Null out prices if config says not to show them
    if (!config.showPrices) {
      screenings = screenings.map((s) => ({ ...s, priceHellers: null }));
    }

    return { ...day, screenings };
  }).filter((day) => day.screenings.length > 0);

  return { ...program, days: filteredDays };
}

/**
 * getNowShowingFilms
 * Returns distinct films currently showing at a venue with next screening time.
 */
export async function getNowShowingFilms(
  venueId: string,
  db: CinemaProgramDB,
): Promise<NowShowingFilm[]> {
  const { rows } = await db.query<NowShowingRow>(
    `SELECT DISTINCT ON (fr.film_id)
       fr.film_id,
       f.title AS film_title,
       f.rating AS film_rating,
       f.duration_minutes AS film_duration_minutes,
       f.poster_url AS film_poster_url,
       f.genre AS film_genre,
       fr.release_date,
       (
         SELECT s.starts_at
         FROM cinema.screenings s
         JOIN cinema.auditoriums a ON a.id = s.auditorium_id
         WHERE s.film_id = fr.film_id
           AND a.venue_id = $1
           AND s.starts_at > NOW()
           AND s.status NOT IN ('cancelled','finished')
         ORDER BY s.starts_at ASC
         LIMIT 1
       ) AS next_screening_at
     FROM cinema.film_releases fr
     JOIN cinema.films f ON f.id = fr.film_id
     WHERE fr.venue_id = $1 AND fr.status = 'now_showing'
     ORDER BY fr.film_id, fr.release_date ASC`,
    [venueId],
  );

  return rows.map((row) => ({
    filmId: row.film_id,
    title: row.film_title,
    rating: row.film_rating,
    durationMinutes: row.film_duration_minutes,
    posterUrl: row.film_poster_url,
    genre: row.film_genre,
    nextScreeningAt: row.next_screening_at,
    releaseDate: row.release_date,
  }));
}

/**
 * getFilmScreenings
 * Returns all upcoming screenings for a specific film at a venue.
 */
export async function getFilmScreenings(
  venueId: string,
  filmId: string,
  db: CinemaProgramDB,
): Promise<PublicScreening[]> {
  const { rows: screeningRows } = await db.query<ScreeningJoinRow>(
    `SELECT
       s.id,
       s.film_id,
       f.title AS film_title,
       f.rating AS film_rating,
       f.duration_minutes AS film_duration_minutes,
       f.poster_url AS film_poster_url,
       f.genre AS film_genre,
       a.id AS auditorium_id,
       a.name AS auditorium_name,
       s.starts_at,
       s.ends_at,
       s.format,
       s.language,
       s.subtitles,
       s.price_hellers,
       s.total_seats,
       s.seats_sold,
       s.status
     FROM cinema.screenings s
     JOIN cinema.films f ON f.id = s.film_id
     JOIN cinema.auditoriums a ON a.id = s.auditorium_id
     WHERE a.venue_id = $1
       AND s.film_id = $2
       AND s.starts_at > NOW()
       AND s.status NOT IN ('cancelled', 'finished')
     ORDER BY s.starts_at ASC`,
    [venueId, filmId],
  );

  if (screeningRows.length === 0) {
    return [];
  }

  const screeningIds = screeningRows.map((r) => r.id);

  const { rows: tagRows } = await db.query<ScreeningTagRow>(
    `SELECT screening_id, tag FROM cinema.screening_tags
     WHERE screening_id = ANY($1)
     ORDER BY tag ASC`,
    [screeningIds],
  );

  const tagsByScreening = new Map<string, string[]>();
  for (const t of tagRows) {
    if (!tagsByScreening.has(t.screening_id)) {
      tagsByScreening.set(t.screening_id, []);
    }
    tagsByScreening.get(t.screening_id)!.push(t.tag);
  }

  return screeningRows.map((row) => ({
    id: row.id,
    film: {
      id: row.film_id,
      title: row.film_title,
      rating: row.film_rating,
      durationMinutes: row.film_duration_minutes,
      posterUrl: row.film_poster_url,
      genre: row.film_genre,
    },
    auditorium: {
      id: row.auditorium_id,
      name: row.auditorium_name,
    },
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    format: row.format,
    language: row.language,
    subtitles: row.subtitles,
    priceHellers: row.price_hellers,
    seatsAvailable: Math.max(0, row.total_seats - row.seats_sold),
    tags: tagsByScreening.get(row.id) ?? [],
    status: row.status,
  }));
}
