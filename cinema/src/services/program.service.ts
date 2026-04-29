import { CinemaError } from '../lib/cinema-errors';
import type { CinemaDB } from './venue.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Program {
  id: string;
  venueId: string;
  weekStart: string;
  publishedAt: string | null;
  notes: string | null;
  createdAt?: string;
}

export interface ScreeningWithFilm {
  id: string;
  filmId: string;
  filmTitle: string;
  filmDurationMinutes: number;
  auditoriumId: string;
  auditoriumName: string;
  startsAt: string;
  endsAt: string;
  format: string | null;
  language: string | null;
  subtitles: string | null;
  priceHellers: number;
  status: string;
  totalSeats: number;
  seatsSold: number;
}

export interface DayProgram {
  date: string;
  screenings: ScreeningWithFilm[];
}

export interface WeeklyProgram {
  program: Program;
  days: DayProgram[];
}

// ---------------------------------------------------------------------------
// Program functions
// ---------------------------------------------------------------------------

export async function createProgram(
  venueId: string,
  weekStart: string,
  db: CinemaDB,
): Promise<Program> {
  const { rows } = await db.query<{
    id: string; venue_id: string; week_start: string;
    published_at: string | null; notes: string | null; created_at: string;
  }>(
    `INSERT INTO cinema.programs (venue_id, week_start)
     VALUES ($1, $2)
     RETURNING *`,
    [venueId, weekStart],
  );

  if (!rows[0]) {
    throw new CinemaError('PROGRAM_DUPLICATE');
  }

  return mapProgram(rows[0]);
}

export async function getProgram(programId: string, db: CinemaDB): Promise<Program> {
  const { rows } = await db.query<{
    id: string; venue_id: string; week_start: string;
    published_at: string | null; notes: string | null; created_at: string;
  }>(
    `SELECT * FROM cinema.programs WHERE id = $1`,
    [programId],
  );

  if (!rows[0]) {
    throw new CinemaError('PROGRAM_NOT_FOUND');
  }

  return mapProgram(rows[0]);
}

export async function getWeeklyProgram(
  venueId: string,
  weekStart: string,
  db: CinemaDB,
): Promise<WeeklyProgram> {
  // Get program
  const { rows: programRows } = await db.query<{
    id: string; venue_id: string; week_start: string;
    published_at: string | null; notes: string | null; created_at: string;
  }>(
    `SELECT * FROM cinema.programs WHERE venue_id = $1 AND week_start = $2`,
    [venueId, weekStart],
  );

  if (!programRows[0]) {
    throw new CinemaError('PROGRAM_NOT_FOUND');
  }

  const program = mapProgram(programRows[0]);

  // Get all screenings for this program with film info
  const { rows: screeningRows } = await db.query<{
    id: string; film_id: string; film_title: string; film_duration_minutes: number;
    auditorium_id: string; auditorium_name: string;
    starts_at: string; ends_at: string; format: string | null;
    language: string | null; subtitles: string | null;
    price_hellers: number; status: string; total_seats: number; seats_sold: number;
  }>(
    `SELECT s.id, s.film_id, f.title AS film_title, f.duration_minutes AS film_duration_minutes,
            s.auditorium_id, a.name AS auditorium_name,
            s.starts_at, s.ends_at, s.format, s.language, s.subtitles,
            s.price_hellers, s.status, s.total_seats, s.seats_sold
     FROM cinema.program_screenings ps
     JOIN cinema.screenings s ON s.id = ps.screening_id
     JOIN cinema.films f ON f.id = s.film_id
     JOIN cinema.auditoriums a ON a.id = s.auditorium_id
     WHERE ps.program_id = $1
     ORDER BY s.starts_at ASC`,
    [program.id],
  );

  // Group by day
  const dayMap = new Map<string, ScreeningWithFilm[]>();
  for (const row of screeningRows) {
    const date = row.starts_at.substring(0, 10);
    if (!dayMap.has(date)) {
      dayMap.set(date, []);
    }
    dayMap.get(date)!.push({
      id: row.id,
      filmId: row.film_id,
      filmTitle: row.film_title,
      filmDurationMinutes: row.film_duration_minutes,
      auditoriumId: row.auditorium_id,
      auditoriumName: row.auditorium_name,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      format: row.format,
      language: row.language,
      subtitles: row.subtitles,
      priceHellers: row.price_hellers,
      status: row.status,
      totalSeats: row.total_seats,
      seatsSold: row.seats_sold,
    });
  }

  const days: DayProgram[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, screenings]) => ({ date, screenings }));

  return { program, days };
}

export async function addScreeningToProgram(
  programId: string,
  screeningId: string,
  db: CinemaDB,
): Promise<void> {
  await db.execute(
    `INSERT INTO cinema.program_screenings (program_id, screening_id)
     VALUES ($1, $2)`,
    [programId, screeningId],
  );
}

export async function removeScreeningFromProgram(
  programId: string,
  screeningId: string,
  db: CinemaDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM cinema.program_screenings
     WHERE program_id = $1 AND screening_id = $2`,
    [programId, screeningId],
  );
}

export async function publishProgram(programId: string, db: CinemaDB): Promise<Program> {
  const { rows } = await db.query<{
    id: string; venue_id: string; week_start: string;
    published_at: string | null; notes: string | null; created_at: string;
  }>(
    `UPDATE cinema.programs SET published_at = NOW() WHERE id = $1 RETURNING *`,
    [programId],
  );

  if (!rows[0]) {
    throw new CinemaError('PROGRAM_NOT_FOUND');
  }

  return mapProgram(rows[0]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapProgram(row: {
  id: string; venue_id: string; week_start: string;
  published_at: string | null; notes: string | null; created_at?: string;
}): Program {
  return {
    id: row.id,
    venueId: row.venue_id,
    weekStart: row.week_start,
    publishedAt: row.published_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}
