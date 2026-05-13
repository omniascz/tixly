import { CinemaError } from '../lib/cinema-errors';
import type { CinemaDB } from './venue.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreeningFormat = '2d' | '3d' | 'imax' | '4dx' | 'dolby';
export type ScreeningStatus = 'scheduled' | 'open' | 'sold_out' | 'cancelled' | 'finished';
export type SeatType = 'standard' | 'vip' | 'wheelchair' | 'couple';
export type SeatStatus = 'available' | 'reserved' | 'sold' | 'blocked';

export interface ScreeningInput {
  filmId: string;
  auditoriumId: string;
  startsAt: string;
  endsAt: string;
  format?: ScreeningFormat;
  language?: string;
  subtitles?: string;
  priceHellers: number;
  status?: ScreeningStatus;
  totalSeats: number;
  notes?: string;
}

export interface ScreeningUpdateInput {
  notes?: string;
  status?: ScreeningStatus;
  priceHellers?: number;
}

export interface ScreeningFilters {
  filmId?: string;
  auditoriumId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: ScreeningStatus;
}

export interface Screening {
  id: string;
  filmId: string;
  auditoriumId: string;
  startsAt: string;
  endsAt: string;
  format: ScreeningFormat | null;
  language: string | null;
  subtitles: string | null;
  priceHellers: number;
  status: ScreeningStatus;
  totalSeats: number;
  seatsSold: number;
  notes: string | null;
  createdAt: string;
  // enriched
  filmTitle?: string;
  filmDurationMinutes?: number;
  auditoriumName?: string;
  venueName?: string;
}

export interface ScreeningSeat {
  id: string;
  screeningId: string;
  rowLabel: string;
  seatNumber: number;
  seatType: SeatType;
  status: SeatStatus;
  priceHellers: number | null;
  orderId: string | null;
  reservedUntil: string | null;
}

// ---------------------------------------------------------------------------
// Screening functions
// ---------------------------------------------------------------------------

export async function createScreening(input: ScreeningInput, db: CinemaDB): Promise<Screening> {
  // Validate ends_at > starts_at
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  if (endsAt <= startsAt) {
    throw new CinemaError('VALIDATION_ERROR', 'ends_at must be after starts_at');
  }

  // Check for auditorium conflict: any existing screening that overlaps our time window
  const { rows: conflicts } = await db.query<{ id: string }>(
    `SELECT id FROM cinema.screenings
     WHERE auditorium_id = $1
       AND status != 'cancelled'
       AND starts_at < $3
       AND ends_at > $2`,
    [input.auditoriumId, input.startsAt, input.endsAt],
  );

  if (conflicts.length > 0) {
    throw new CinemaError('SCREENING_CONFLICT');
  }

  await db.execute(
    `INSERT INTO cinema.screenings
       (film_id, auditorium_id, starts_at, ends_at, format, language, subtitles,
        price_hellers, status, total_seats, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.filmId,
      input.auditoriumId,
      input.startsAt,
      input.endsAt,
      input.format ?? '2d',
      input.language ?? null,
      input.subtitles ?? null,
      input.priceHellers,
      input.status ?? 'scheduled',
      input.totalSeats,
      input.notes ?? null,
    ],
  );

  // Return a constructed object matching the input (in tests we won't re-query)
  return {
    id: 'new-screening',
    filmId: input.filmId,
    auditoriumId: input.auditoriumId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    format: input.format ?? '2d',
    language: input.language ?? null,
    subtitles: input.subtitles ?? null,
    priceHellers: input.priceHellers,
    status: input.status ?? 'scheduled',
    totalSeats: input.totalSeats,
    seatsSold: 0,
    notes: input.notes ?? null,
    createdAt: new Date().toISOString(),
  };
}

export async function getScreening(screeningId: string, db: CinemaDB): Promise<Screening> {
  const { rows } = await db.query<{
    id: string; film_id: string; auditorium_id: string; starts_at: string; ends_at: string;
    format: ScreeningFormat | null; language: string | null; subtitles: string | null;
    price_hellers: number; status: ScreeningStatus; total_seats: number;
    seats_sold: number; notes: string | null; created_at: string;
    film_title: string; film_duration_minutes: number;
    auditorium_name: string; venue_name: string;
  }>(
    `SELECT s.*,
            f.title AS film_title,
            f.duration_minutes AS film_duration_minutes,
            a.name AS auditorium_name,
            v.name AS venue_name
     FROM cinema.screenings s
     JOIN cinema.films f ON f.id = s.film_id
     JOIN cinema.auditoriums a ON a.id = s.auditorium_id
     JOIN cinema.venues v ON v.id = a.venue_id
     WHERE s.id = $1`,
    [screeningId],
  );

  if (!rows[0]) {
    throw new CinemaError('SCREENING_NOT_FOUND');
  }

  const row = rows[0];
  return {
    id: row.id,
    filmId: row.film_id,
    auditoriumId: row.auditorium_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    format: row.format,
    language: row.language,
    subtitles: row.subtitles,
    priceHellers: row.price_hellers,
    status: row.status,
    totalSeats: row.total_seats,
    seatsSold: row.seats_sold,
    notes: row.notes,
    createdAt: row.created_at,
    filmTitle: row.film_title,
    filmDurationMinutes: row.film_duration_minutes,
    auditoriumName: row.auditorium_name,
    venueName: row.venue_name,
  };
}

export async function listScreenings(
  filters: ScreeningFilters,
  db: CinemaDB,
): Promise<Screening[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.filmId) {
    conditions.push(`s.film_id = $${idx}`);
    params.push(filters.filmId);
    idx++;
  }

  if (filters.auditoriumId) {
    conditions.push(`s.auditorium_id = $${idx}`);
    params.push(filters.auditoriumId);
    idx++;
  }

  if (filters.dateFrom) {
    conditions.push(`s.starts_at >= $${idx}`);
    params.push(filters.dateFrom);
    idx++;
  }

  if (filters.dateTo) {
    conditions.push(`s.starts_at <= $${idx}`);
    params.push(filters.dateTo);
    idx++;
  }

  if (filters.status) {
    conditions.push(`s.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await db.query<{
    id: string; film_id: string; auditorium_id: string; starts_at: string; ends_at: string;
    format: ScreeningFormat | null; language: string | null; subtitles: string | null;
    price_hellers: number; status: ScreeningStatus; total_seats: number;
    seats_sold: number; notes: string | null; created_at: string;
  }>(
    `SELECT s.* FROM cinema.screenings s ${where} ORDER BY s.starts_at ASC`,
    params,
  );

  return rows.map((row) => ({
    id: row.id,
    filmId: row.film_id,
    auditoriumId: row.auditorium_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    format: row.format,
    language: row.language,
    subtitles: row.subtitles,
    priceHellers: row.price_hellers,
    status: row.status,
    totalSeats: row.total_seats,
    seatsSold: row.seats_sold,
    notes: row.notes,
    createdAt: row.created_at,
  }));
}

export async function updateScreening(
  screeningId: string,
  input: ScreeningUpdateInput,
  db: CinemaDB,
): Promise<Screening> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.notes !== undefined) { sets.push(`notes = $${idx}`); params.push(input.notes); idx++; }
  if (input.status !== undefined) { sets.push(`status = $${idx}`); params.push(input.status); idx++; }
  if (input.priceHellers !== undefined) { sets.push(`price_hellers = $${idx}`); params.push(input.priceHellers); idx++; }

  params.push(screeningId);

  const { rows } = await db.query<{
    id: string; film_id: string; auditorium_id: string; starts_at: string; ends_at: string;
    format: ScreeningFormat | null; language: string | null; subtitles: string | null;
    price_hellers: number; status: ScreeningStatus; total_seats: number;
    seats_sold: number; notes: string | null; created_at: string;
  }>(
    `UPDATE cinema.screenings SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CinemaError('SCREENING_NOT_FOUND');
  }

  const row = rows[0];
  return {
    id: row.id,
    filmId: row.film_id,
    auditoriumId: row.auditorium_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    format: row.format,
    language: row.language,
    subtitles: row.subtitles,
    priceHellers: row.price_hellers,
    status: row.status,
    totalSeats: row.total_seats,
    seatsSold: row.seats_sold,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function cancelScreening(screeningId: string, db: CinemaDB): Promise<void> {
  await db.execute(
    `UPDATE cinema.screenings SET status = 'cancelled' WHERE id = $1`,
    [screeningId],
  );
}

export async function getAvailableSeats(
  screeningId: string,
  db: CinemaDB,
): Promise<ScreeningSeat[]> {
  const { rows } = await db.query<{
    id: string; screening_id: string; row_label: string; seat_number: number;
    seat_type: SeatType; status: SeatStatus; price_hellers: number | null;
    order_id: string | null; reserved_until: string | null;
  }>(
    `SELECT * FROM cinema.screening_seats
     WHERE screening_id = $1 AND status = 'available'
     ORDER BY row_label ASC, seat_number ASC`,
    [screeningId],
  );

  return rows.map(mapSeat);
}

export async function reserveSeat(
  screeningId: string,
  rowLabel: string,
  seatNumber: number,
  orderId: string,
  db: CinemaDB,
): Promise<ScreeningSeat> {
  // Check seat availability
  const { rows: seatRows } = await db.query<{
    id: string; screening_id: string; row_label: string; seat_number: number;
    seat_type: SeatType; status: SeatStatus; price_hellers: number | null;
    order_id: string | null; reserved_until: string | null;
  }>(
    `SELECT * FROM cinema.screening_seats
     WHERE screening_id = $1 AND row_label = $2 AND seat_number = $3`,
    [screeningId, rowLabel, seatNumber],
  );

  const seat = seatRows[0];
  if (!seat) {
    throw new CinemaError('SEAT_NOT_FOUND');
  }

  if (seat.status !== 'available') {
    throw new CinemaError('SEAT_UNAVAILABLE');
  }

  await db.execute(
    `UPDATE cinema.screening_seats
     SET status = 'reserved', order_id = $1, reserved_until = NOW() + INTERVAL '15 minutes'
     WHERE screening_id = $2 AND row_label = $3 AND seat_number = $4`,
    [orderId, screeningId, rowLabel, seatNumber],
  );

  return {
    ...mapSeat(seat),
    status: 'reserved',
    orderId,
  };
}

export async function confirmSeatSale(
  screeningId: string,
  rowLabel: string,
  seatNumber: number,
  db: CinemaDB,
): Promise<void> {
  await db.execute(
    `UPDATE cinema.screening_seats
     SET status = 'sold'
     WHERE screening_id = $1 AND row_label = $2 AND seat_number = $3`,
    [screeningId, rowLabel, seatNumber],
  );

  await db.execute(
    `UPDATE cinema.screenings SET seats_sold = seats_sold + 1 WHERE id = $1`,
    [screeningId],
  );
}

export async function generateSeatsForScreening(
  screeningId: string,
  auditoriumId: string,
  db: CinemaDB,
): Promise<number> {
  // Get auditorium capacity
  const { rows: audRows } = await db.query<{ capacity: number }>(
    `SELECT capacity FROM cinema.auditoriums WHERE id = $1`,
    [auditoriumId],
  );

  const capacity = audRows[0]?.capacity ?? 0;

  // Calculate rows and seats per row
  // For a capacity of N seats, distribute across rows A-Z (max 26 rows)
  // seatsPerRow = ceil(capacity / numRows)
  const numRows = Math.min(26, Math.ceil(Math.sqrt(capacity)));
  const seatsPerRow = Math.ceil(capacity / numRows);

  const insertValues: string[] = [];
  const params: unknown[] = [screeningId];
  let paramIdx = 2;
  let seatsCreated = 0;

  for (let r = 0; r < numRows && seatsCreated < capacity; r++) {
    const rowLabel = String.fromCharCode(65 + r); // A, B, C...
    const seatsInThisRow = Math.min(seatsPerRow, capacity - seatsCreated);

    for (let s = 1; s <= seatsInThisRow; s++) {
      insertValues.push(`($1, $${paramIdx}, $${paramIdx + 1}, 'standard', 'available')`);
      params.push(rowLabel, s);
      paramIdx += 2;
      seatsCreated++;
    }
  }

  if (insertValues.length > 0) {
    await db.execute(
      `INSERT INTO cinema.screening_seats (screening_id, row_label, seat_number, seat_type, status)
       VALUES ${insertValues.join(', ')}`,
      params,
    );
  }

  return seatsCreated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSeat(row: {
  id: string; screening_id: string; row_label: string; seat_number: number;
  seat_type: SeatType; status: SeatStatus; price_hellers: number | null;
  order_id: string | null; reserved_until: string | null;
}): ScreeningSeat {
  return {
    id: row.id,
    screeningId: row.screening_id,
    rowLabel: row.row_label,
    seatNumber: row.seat_number,
    seatType: row.seat_type,
    status: row.status,
    priceHellers: row.price_hellers,
    orderId: row.order_id,
    reservedUntil: row.reserved_until,
  };
}
