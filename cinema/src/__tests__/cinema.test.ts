import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CinemaError, isCinemaError } from '../lib/cinema-errors';
import {
  createVenue,
  getVenue,
  listVenues,
  createAuditorium,
  getAuditorium,
  listAuditoriums,
} from '../services/venue.service';
import {
  createFilm,
  getFilm,
  listFilms,
  updateFilm,
  searchFilms,
} from '../services/film.service';
import {
  createScreening,
  getScreening,
  listScreenings,
  cancelScreening,
  getAvailableSeats,
  reserveSeat,
  confirmSeatSale,
  generateSeatsForScreening,
} from '../services/screening.service';
import {
  createProgram,
  getProgram,
  getWeeklyProgram,
  addScreeningToProgram,
  publishProgram,
} from '../services/program.service';

// ---------------------------------------------------------------------------
// makeDb helper
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROMOTER_ID = 'promoter-uuid-0001';
const VENUE_ID = 'venue-uuid-0001';
const AUDITORIUM_ID = 'auditorium-uuid-0001';
const FILM_ID = 'film-uuid-0001';
const SCREENING_ID = 'screening-uuid-0001';
const PROGRAM_ID = 'program-uuid-0001';

const VENUE_ROW = {
  id: VENUE_ID,
  promoter_id: PROMOTER_ID,
  name: 'Bio Oko',
  address: 'Františka Křížka 460/15',
  city: 'Praha',
  timezone: 'Europe/Prague',
  website_url: 'https://biooko.net',
  created_at: '2026-04-07T10:00:00.000Z',
};

const AUDITORIUM_ROW = {
  id: AUDITORIUM_ID,
  venue_id: VENUE_ID,
  name: 'Sál 1',
  capacity: 120,
  has_3d: false,
  has_imax: false,
  has_dolby: true,
  seating_map_url: null,
  created_at: '2026-04-07T10:00:00.000Z',
};

const FILM_ROW = {
  id: FILM_ID,
  promoter_id: PROMOTER_ID,
  title: 'Duna: Část druhá',
  original_title: 'Dune: Part Two',
  synopsis: 'Pokračování epické ságy.',
  duration_minutes: 166,
  language: 'cs',
  subtitles: 'en',
  genre: 'sci-fi',
  director: 'Denis Villeneuve',
  cast_list: ['Timothée Chalamet', 'Zendaya'],
  poster_url: null,
  trailer_url: null,
  imdb_id: 'tt15239678',
  release_year: 2024,
  rating: '12+',
  created_at: '2026-04-07T10:00:00.000Z',
};

const SCREENING_ROW = {
  id: SCREENING_ID,
  film_id: FILM_ID,
  auditorium_id: AUDITORIUM_ID,
  starts_at: '2026-04-10T19:00:00.000Z',
  ends_at: '2026-04-10T21:46:00.000Z',
  format: '2d',
  language: 'cs',
  subtitles: null,
  price_hellers: 25000,
  status: 'scheduled',
  total_seats: 120,
  seats_sold: 0,
  notes: null,
  created_at: '2026-04-07T10:00:00.000Z',
};

const SCREENING_DETAIL_ROW = {
  ...SCREENING_ROW,
  film_title: 'Duna: Část druhá',
  film_duration_minutes: 166,
  auditorium_name: 'Sál 1',
  venue_name: 'Bio Oko',
};

const PROGRAM_ROW = {
  id: PROGRAM_ID,
  venue_id: VENUE_ID,
  week_start: '2026-04-07',
  published_at: null,
  notes: null,
  created_at: '2026-04-07T10:00:00.000Z',
};

const SEAT_ROW = {
  id: 'seat-uuid-0001',
  screening_id: SCREENING_ID,
  row_label: 'A',
  seat_number: 1,
  seat_type: 'standard',
  status: 'available',
  price_hellers: null,
  order_id: null,
  reserved_until: null,
};

// ===========================================================================
// 1. Venue tests
// ===========================================================================

describe('createVenue', () => {
  it('valid — vytvoří venue a vrátí mapované pole', async () => {
    const db = makeDb([[VENUE_ROW]]);
    const venue = await createVenue(PROMOTER_ID, { name: 'Bio Oko', city: 'Praha' }, db);
    expect(venue.id).toBe(VENUE_ID);
    expect(venue.promoterId).toBe(PROMOTER_ID);
    expect(venue.name).toBe('Bio Oko');
    expect(db.query).toHaveBeenCalledOnce();
  });

  it('duplicate — hodí VENUE_DUPLICATE (INSERT vrátí prázdné rows)', async () => {
    const db = makeDb([[]]); // INSERT RETURNING vrátí prázdno
    try {
      await createVenue(PROMOTER_ID, { name: 'Bio Oko' }, db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('VENUE_DUPLICATE');
    }
  });
});

describe('getVenue', () => {
  it('found — vrátí venue s auditorium_count', async () => {
    const db = makeDb([[{ ...VENUE_ROW, auditorium_count: '3' }]]);
    const venue = await getVenue(VENUE_ID, db);
    expect(venue.id).toBe(VENUE_ID);
    expect(venue.auditoriumCount).toBe(3);
  });

  it('not found — hodí VENUE_NOT_FOUND', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    try {
      await getVenue('nonexistent', db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('VENUE_NOT_FOUND');
    }
  });
});

describe('listVenues', () => {
  it('vrátí pole venues', async () => {
    const db = makeDb([[VENUE_ROW, { ...VENUE_ROW, id: 'venue-2', name: 'Kinokavárna' }]]);
    const venues = await listVenues(PROMOTER_ID, db);
    expect(venues).toHaveLength(2);
    expect(venues[0].name).toBe('Bio Oko');
  });
});

// ===========================================================================
// 2. Auditorium tests
// ===========================================================================

describe('createAuditorium', () => {
  it('valid — vytvoří auditorium', async () => {
    const db = makeDb([[AUDITORIUM_ROW]]);
    const aud = await createAuditorium(VENUE_ID, { name: 'Sál 1', capacity: 120 }, db);
    expect(aud.id).toBe(AUDITORIUM_ID);
    expect(aud.venueId).toBe(VENUE_ID);
    expect(aud.capacity).toBe(120);
    expect(aud.hasDolby).toBe(true);
  });

  it('duplicate — hodí AUDITORIUM_DUPLICATE', async () => {
    const db = makeDb([[]]); // INSERT vrátí prázdno
    try {
      await createAuditorium(VENUE_ID, { name: 'Sál 1', capacity: 120 }, db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('AUDITORIUM_DUPLICATE');
    }
  });
});

describe('listAuditoriums', () => {
  it('vrátí pole auditorií pro venue', async () => {
    const db = makeDb([[AUDITORIUM_ROW, { ...AUDITORIUM_ROW, id: 'aud-2', name: 'Sál 2' }]]);
    const auds = await listAuditoriums(VENUE_ID, db);
    expect(auds).toHaveLength(2);
    expect(auds[1].name).toBe('Sál 2');
  });
});

// ===========================================================================
// 3. Film tests
// ===========================================================================

describe('createFilm', () => {
  it('valid — vytvoří film a mapuje camelCase', async () => {
    const db = makeDb([[FILM_ROW]]);
    const film = await createFilm(PROMOTER_ID, {
      title: 'Duna: Část druhá',
      durationMinutes: 166,
      imdbId: 'tt15239678',
    }, db);
    expect(film.id).toBe(FILM_ID);
    expect(film.durationMinutes).toBe(166);
    expect(film.imdbId).toBe('tt15239678');
  });

  it('duplicate imdb_id — hodí FILM_DUPLICATE', async () => {
    const db = makeDb([[]]); // INSERT vrátí prázdno
    try {
      await createFilm(PROMOTER_ID, { title: 'Duna', durationMinutes: 166, imdbId: 'tt15239678' }, db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('FILM_DUPLICATE');
    }
  });
});

describe('getFilm', () => {
  it('found — vrátí film', async () => {
    const db = makeDb([[FILM_ROW]]);
    const film = await getFilm(FILM_ID, db);
    expect(film.title).toBe('Duna: Část druhá');
    expect(film.genre).toBe('sci-fi');
  });

  it('not found — hodí FILM_NOT_FOUND', async () => {
    const db = makeDb([[]]); // prázdný výsledek
    try {
      await getFilm('nonexistent', db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('FILM_NOT_FOUND');
    }
  });
});

describe('listFilms', () => {
  it('filter by genre — vrátí odpovídající filmy', async () => {
    const db = makeDb([[FILM_ROW]]);
    const films = await listFilms(PROMOTER_ID, { genre: 'sci-fi' }, db);
    expect(films).toHaveLength(1);
    expect(films[0].genre).toBe('sci-fi');
  });

  it('filter by language — vrátí odpovídající filmy', async () => {
    const db = makeDb([[FILM_ROW]]);
    const films = await listFilms(PROMOTER_ID, { language: 'cs' }, db);
    expect(films).toHaveLength(1);
    expect(films[0].language).toBe('cs');
  });
});

describe('updateFilm', () => {
  it('partial update — změní jen zadaná pole', async () => {
    const updatedRow = { ...FILM_ROW, rating: '15+', genre: 'drama' };
    const db = makeDb([[updatedRow]]);
    const film = await updateFilm(FILM_ID, { rating: '15+', genre: 'drama' }, db);
    expect(film.rating).toBe('15+');
    expect(film.genre).toBe('drama');
  });
});

describe('searchFilms', () => {
  it('vrátí výsledky odpovídající dotazu', async () => {
    const db = makeDb([[FILM_ROW]]);
    const films = await searchFilms(PROMOTER_ID, 'Duna', db);
    expect(films).toHaveLength(1);
    expect(films[0].title).toBe('Duna: Část druhá');
  });
});

// ===========================================================================
// 4. Screening tests
// ===========================================================================

describe('createScreening', () => {
  it('valid — vytvoří screening (1 query + 1 execute)', async () => {
    // 1 query: conflict check → [] (no conflicts)
    // 1 execute: INSERT
    const db = makeDb([[]]); // conflict check vrátí prázdno
    const screening = await createScreening({
      filmId: FILM_ID,
      auditoriumId: AUDITORIUM_ID,
      startsAt: '2026-04-10T19:00:00.000Z',
      endsAt: '2026-04-10T21:46:00.000Z',
      priceHellers: 25000,
      totalSeats: 120,
    }, db);
    expect(screening.filmId).toBe(FILM_ID);
    expect(screening.priceHellers).toBe(25000);
    expect(db.query).toHaveBeenCalledOnce(); // only conflict check
    expect(db.execute).toHaveBeenCalledOnce(); // INSERT
  });

  it('auditorium conflict — hodí SCREENING_CONFLICT', async () => {
    // 1 query: conflict check vrátí existující screening
    const db = makeDb([[{ id: 'existing-screening' }]]);
    try {
      await createScreening({
        filmId: FILM_ID,
        auditoriumId: AUDITORIUM_ID,
        startsAt: '2026-04-10T19:30:00.000Z',
        endsAt: '2026-04-10T20:00:00.000Z',
        priceHellers: 25000,
        totalSeats: 120,
      }, db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('SCREENING_CONFLICT');
    }
  });

  it('ends_at <= starts_at — hodí VALIDATION_ERROR (bez DB query)', async () => {
    const db = makeDb([]);
    try {
      await createScreening({
        filmId: FILM_ID,
        auditoriumId: AUDITORIUM_ID,
        startsAt: '2026-04-10T21:46:00.000Z',
        endsAt: '2026-04-10T19:00:00.000Z', // BEFORE starts_at
        priceHellers: 25000,
        totalSeats: 120,
      }, db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('VALIDATION_ERROR');
    }
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('getScreening', () => {
  it('with film + auditorium info — vrátí obohacený screening', async () => {
    const db = makeDb([[SCREENING_DETAIL_ROW]]);
    const screening = await getScreening(SCREENING_ID, db);
    expect(screening.id).toBe(SCREENING_ID);
    expect(screening.filmTitle).toBe('Duna: Část druhá');
    expect(screening.auditoriumName).toBe('Sál 1');
    expect(screening.venueName).toBe('Bio Oko');
  });
});

describe('listScreenings', () => {
  it('filter by film_id — vrátí odpovídající screeningy', async () => {
    const db = makeDb([[SCREENING_ROW]]);
    const screenings = await listScreenings({ filmId: FILM_ID }, db);
    expect(screenings).toHaveLength(1);
    expect(screenings[0].filmId).toBe(FILM_ID);
  });

  it('filter by date range — vrátí screeningy v rozsahu', async () => {
    const db = makeDb([[SCREENING_ROW]]);
    const screenings = await listScreenings({
      dateFrom: '2026-04-10T00:00:00.000Z',
      dateTo: '2026-04-10T23:59:59.000Z',
    }, db);
    expect(screenings).toHaveLength(1);
    expect(screenings[0].startsAt).toBe('2026-04-10T19:00:00.000Z');
  });
});

describe('cancelScreening', () => {
  it('nastaví status=cancelled (1 execute)', async () => {
    const db = makeDb([]);
    await cancelScreening(SCREENING_ID, db);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      [SCREENING_ID],
    );
  });
});

// ===========================================================================
// 5. Seat tests
// ===========================================================================

describe('getAvailableSeats', () => {
  it('vrátí pouze available seats', async () => {
    const reservedSeat = { ...SEAT_ROW, id: 'seat-2', seat_number: 2, status: 'reserved' };
    const db = makeDb([[SEAT_ROW]]); // pouze available
    const seats = await getAvailableSeats(SCREENING_ID, db);
    expect(seats).toHaveLength(1);
    expect(seats[0].status).toBe('available');
    expect(seats[0].rowLabel).toBe('A');
  });
});

describe('reserveSeat', () => {
  it('valid — status=reserved, order_id nastaven (1 query + 1 execute)', async () => {
    const db = makeDb([[SEAT_ROW]]); // SELECT vrátí available seat
    const seat = await reserveSeat(SCREENING_ID, 'A', 1, 'order-uuid', db);
    expect(seat.status).toBe('reserved');
    expect(seat.orderId).toBe('order-uuid');
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('seat not available — hodí SEAT_UNAVAILABLE', async () => {
    const reservedSeat = { ...SEAT_ROW, status: 'reserved' };
    const db = makeDb([[reservedSeat]]);
    try {
      await reserveSeat(SCREENING_ID, 'A', 1, 'order-uuid', db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('SEAT_UNAVAILABLE');
    }
  });
});

describe('confirmSeatSale', () => {
  it('status=sold, seats_sold inkrementováno (2 execute)', async () => {
    const db = makeDb([]);
    await confirmSeatSale(SCREENING_ID, 'A', 1, db);
    expect(db.execute).toHaveBeenCalledTimes(2);
    // První execute: UPDATE seat status='sold'
    expect(db.execute.mock.calls[0][0]).toContain("status = 'sold'");
    // Druhý execute: UPDATE seats_sold = seats_sold + 1
    expect(db.execute.mock.calls[1][0]).toContain('seats_sold = seats_sold + 1');
  });
});

describe('generateSeatsForScreening', () => {
  it('vytvoří správný počet sedadel pro kapacitu auditoria', async () => {
    // 1 query: SELECT capacity
    // 1 execute: bulk INSERT
    const db = makeDb([[{ capacity: 10 }]]); // kapacita 10
    const count = await generateSeatsForScreening(SCREENING_ID, AUDITORIUM_ID, db);
    expect(count).toBe(10);
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledOnce();
    // Kontrola že INSERT obsahuje screening_id
    expect(db.execute.mock.calls[0][1]).toContain(SCREENING_ID);
  });
});

// ===========================================================================
// 6. Program tests
// ===========================================================================

describe('createProgram', () => {
  it('valid — vytvoří program', async () => {
    const db = makeDb([[PROGRAM_ROW]]);
    const program = await createProgram(VENUE_ID, '2026-04-07', db);
    expect(program.id).toBe(PROGRAM_ID);
    expect(program.venueId).toBe(VENUE_ID);
    expect(program.weekStart).toBe('2026-04-07');
    expect(program.publishedAt).toBeNull();
  });

  it('duplicate — hodí PROGRAM_DUPLICATE', async () => {
    const db = makeDb([[]]); // INSERT vrátí prázdno
    try {
      await createProgram(VENUE_ID, '2026-04-07', db);
      expect.fail('Měla se hodit chyba');
    } catch (err) {
      expect(isCinemaError(err) && err.code).toBe('PROGRAM_DUPLICATE');
    }
  });
});

describe('getWeeklyProgram', () => {
  it('vrátí program se screeningy skupenými podle dne', async () => {
    const screeningForProgram = {
      id: SCREENING_ID,
      film_id: FILM_ID,
      film_title: 'Duna: Část druhá',
      film_duration_minutes: 166,
      auditorium_id: AUDITORIUM_ID,
      auditorium_name: 'Sál 1',
      starts_at: '2026-04-10T19:00:00.000Z',
      ends_at: '2026-04-10T21:46:00.000Z',
      format: '2d',
      language: 'cs',
      subtitles: null,
      price_hellers: 25000,
      status: 'scheduled',
      total_seats: 120,
      seats_sold: 0,
    };
    const screening2 = {
      ...screeningForProgram,
      id: 'screening-2',
      starts_at: '2026-04-11T17:00:00.000Z',
      ends_at: '2026-04-11T19:46:00.000Z',
    };
    // 2 queries: 1 for program, 1 for screenings
    const db = makeDb([
      [PROGRAM_ROW],
      [screeningForProgram, screening2],
    ]);
    const result = await getWeeklyProgram(VENUE_ID, '2026-04-07', db);
    expect(result.program.id).toBe(PROGRAM_ID);
    expect(result.days).toHaveLength(2);
    expect(result.days[0].date).toBe('2026-04-10');
    expect(result.days[0].screenings).toHaveLength(1);
    expect(result.days[1].date).toBe('2026-04-11');
  });
});

describe('addScreeningToProgram', () => {
  it('přidá screening do programu (1 execute)', async () => {
    const db = makeDb([]);
    await addScreeningToProgram(PROGRAM_ID, SCREENING_ID, db);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cinema.program_screenings'),
      [PROGRAM_ID, SCREENING_ID],
    );
  });
});

describe('publishProgram', () => {
  it('nastaví published_at na aktuální čas', async () => {
    const publishedRow = {
      ...PROGRAM_ROW,
      published_at: '2026-04-07T12:00:00.000Z',
    };
    const db = makeDb([[publishedRow]]);
    const program = await publishProgram(PROGRAM_ID, db);
    expect(program.publishedAt).toBe('2026-04-07T12:00:00.000Z');
    expect(db.query).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// 7. Full flow integration test
// ===========================================================================

describe('Full flow: venue → auditorium → film → screening → seats → reserve → confirm', () => {
  it('kompletní workflow projde bez chyb', async () => {
    // Steps:
    // 1. createVenue     → 1 query
    // 2. createAuditorium → 1 query
    // 3. createFilm      → 1 query
    // 4. createScreening → 1 query (conflict check) + 1 execute
    // 5. generateSeats   → 1 query (capacity) + 1 execute
    // 6. getAvailableSeats → 1 query
    // 7. reserveSeat     → 1 query (seat check) + 1 execute
    // 8. confirmSeatSale → 0 queries + 2 execute

    const db = makeDb([
      [VENUE_ROW],           // createVenue
      [AUDITORIUM_ROW],      // createAuditorium
      [FILM_ROW],            // createFilm
      [],                    // createScreening: conflict check → no conflicts
      [{ capacity: 10 }],    // generateSeats: get capacity
      [SEAT_ROW],            // getAvailableSeats
      [SEAT_ROW],            // reserveSeat: seat check
    ]);

    // 1. Create venue
    const venue = await createVenue(PROMOTER_ID, { name: 'Bio Oko' }, db);
    expect(venue.id).toBe(VENUE_ID);

    // 2. Create auditorium
    const auditorium = await createAuditorium(venue.id, { name: 'Sál 1', capacity: 10 }, db);
    expect(auditorium.id).toBe(AUDITORIUM_ID);

    // 3. Create film
    const film = await createFilm(PROMOTER_ID, {
      title: 'Duna: Část druhá',
      durationMinutes: 166,
    }, db);
    expect(film.id).toBe(FILM_ID);

    // 4. Create screening
    const screening = await createScreening({
      filmId: film.id,
      auditoriumId: auditorium.id,
      startsAt: '2026-04-10T19:00:00.000Z',
      endsAt: '2026-04-10T21:46:00.000Z',
      priceHellers: 25000,
      totalSeats: 10,
    }, db);
    expect(screening.filmId).toBe(film.id);

    // 5. Generate seats
    const seatCount = await generateSeatsForScreening(SCREENING_ID, auditorium.id, db);
    expect(seatCount).toBe(10);

    // 6. Get available seats
    const availableSeats = await getAvailableSeats(SCREENING_ID, db);
    expect(availableSeats.length).toBeGreaterThan(0);

    // 7. Reserve seat
    const reserved = await reserveSeat(SCREENING_ID, 'A', 1, 'order-uuid-001', db);
    expect(reserved.status).toBe('reserved');

    // 8. Confirm sale
    await confirmSeatSale(SCREENING_ID, 'A', 1, db);
    // executes: 1 (createScreening INSERT) + 1 (generateSeats bulk INSERT)
    //           + 1 (reserveSeat UPDATE) + 2 (confirmSeatSale: UPDATE seat + UPDATE seats_sold) = 5
    expect(db.execute).toHaveBeenCalledTimes(5);
  });
});

// ===========================================================================
// 8. API route tests
// ===========================================================================

describe('API route: POST /cinema/screenings', () => {
  it('201 on valid input', async () => {
    const { POST } = await import('../app/api/cinema/screenings/route');
    const db = makeDb([[]]); // conflict check → no conflicts
    const request = new Request('http://localhost/api/cinema/screenings', {
      method: 'POST',
      body: JSON.stringify({
        filmId: FILM_ID,
        auditoriumId: AUDITORIUM_ID,
        startsAt: '2026-04-10T19:00:00.000Z',
        endsAt: '2026-04-10T21:46:00.000Z',
        priceHellers: 25000,
        totalSeats: 120,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as unknown as import('next/server').NextRequest, { deps: { db } });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.filmId).toBe(FILM_ID);
  });

  it('409 on conflict', async () => {
    const { POST } = await import('../app/api/cinema/screenings/route');
    const db = makeDb([[{ id: 'conflicting-screening' }]]); // conflict exists
    const request = new Request('http://localhost/api/cinema/screenings', {
      method: 'POST',
      body: JSON.stringify({
        filmId: FILM_ID,
        auditoriumId: AUDITORIUM_ID,
        startsAt: '2026-04-10T19:30:00.000Z',
        endsAt: '2026-04-10T20:00:00.000Z',
        priceHellers: 25000,
        totalSeats: 120,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request as unknown as import('next/server').NextRequest, { deps: { db } });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('SCREENING_CONFLICT');
  });
});

describe('API route: GET /cinema/venues/[venueId]/programs/[weekStart]', () => {
  it('200 with weekly program data', async () => {
    const { GET } = await import('../app/api/cinema/venues/[venueId]/programs/[weekStart]/route');
    const db = makeDb([
      [PROGRAM_ROW],
      [{
        id: SCREENING_ID,
        film_id: FILM_ID,
        film_title: 'Duna: Část druhá',
        film_duration_minutes: 166,
        auditorium_id: AUDITORIUM_ID,
        auditorium_name: 'Sál 1',
        starts_at: '2026-04-10T19:00:00.000Z',
        ends_at: '2026-04-10T21:46:00.000Z',
        format: '2d',
        language: 'cs',
        subtitles: null,
        price_hellers: 25000,
        status: 'scheduled',
        total_seats: 120,
        seats_sold: 0,
      }],
    ]);

    const request = new Request('http://localhost/api/cinema/venues/venue-1/programs/2026-04-07', {
      method: 'GET',
    });

    const response = await GET(
      request as unknown as import('next/server').NextRequest,
      {
        params: { venueId: VENUE_ID, weekStart: '2026-04-07' },
        deps: { db },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.program.id).toBe(PROGRAM_ID);
    expect(body.days).toHaveLength(1);
    expect(body.days[0].date).toBe('2026-04-10');
  });
});

// ===========================================================================
// 9. CinemaError tests
// ===========================================================================

describe('CinemaError', () => {
  it('má správný statusCode a code pro VENUE_NOT_FOUND', () => {
    const err = new CinemaError('VENUE_NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('VENUE_NOT_FOUND');
    expect(err instanceof Error).toBe(true);
  });

  it('má statusCode 409 pro SCREENING_CONFLICT', () => {
    expect(new CinemaError('SCREENING_CONFLICT').statusCode).toBe(409);
  });

  it('má statusCode 422 pro SCREENING_CANCELLED', () => {
    expect(new CinemaError('SCREENING_CANCELLED').statusCode).toBe(422);
  });

  it('toHttpError vrátí správný tvar', () => {
    const http = new CinemaError('FILM_NOT_FOUND').toHttpError();
    expect(http).toMatchObject({ error: 'FILM_NOT_FOUND', statusCode: 404 });
    expect(typeof http.message).toBe('string');
  });

  it('isCinemaError vrátí true pro CinemaError instance', () => {
    const err = new CinemaError('SEAT_UNAVAILABLE');
    expect(isCinemaError(err)).toBe(true);
    expect(isCinemaError(new Error('generic'))).toBe(false);
  });
});
