/**
 * Extended cinema tests — covers updateScreening, getAuditorium,
 * removeScreeningFromProgram, and additional service edge cases.
 */
import { describe, it, expect, vi } from 'vitest';
import { updateScreening, getAvailableSeats } from '../services/screening.service';
import { getAuditorium, listAuditoriums } from '../services/venue.service';
import { removeScreeningFromProgram, getProgram } from '../services/program.service';
import { searchFilms, updateFilm } from '../services/film.service';
import { CinemaError } from '../lib/cinema-errors';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  return db;
}

const SCREENING_ROW = {
  id: 'sc-1',
  film_id: 'f-1',
  auditorium_id: 'a-1',
  starts_at: '2026-06-01T18:00:00Z',
  ends_at: '2026-06-01T20:00:00Z',
  format: '2d',
  language: 'cs',
  subtitles: null,
  price_hellers: 25000,
  status: 'open',
  total_seats: 100,
  seats_sold: 0,
  notes: null,
  created_at: '2026-01-01',
};

const AUDITORIUM_ROW = {
  id: 'a-1',
  venue_id: 'v-1',
  name: 'Hall 1',
  rows: 10,
  seats_per_row: 10,
  has_3d: true,
  has_imax: false,
  has_4dx: false,
  has_dolby: true,
  total_capacity: 100,
  is_active: true,
  created_at: '2026-01-01',
};

// ---------------------------------------------------------------------------
// updateScreening
// ---------------------------------------------------------------------------
describe('updateScreening', () => {
  it('updates only provided fields', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [{ ...SCREENING_ROW, notes: 'Special' }] });
    const r = await updateScreening('sc-1', { notes: 'Special' }, db);
    expect(r.notes).toBe('Special');
    const sql = db.query.mock.calls[0][0] as string;
    const setClause = sql.match(/SET\s+([^]+?)\s+WHERE/)?.[1] ?? '';
    expect(setClause).toContain('notes = $1');
    expect(setClause).not.toContain('status');
  });

  it('updates status and price together', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [{ ...SCREENING_ROW, status: 'sold_out', price_hellers: 30000 }] });
    const r = await updateScreening('sc-1', { status: 'sold_out', priceHellers: 30000 }, db);
    expect(r.status).toBe('sold_out');
    expect(r.priceHellers).toBe(30000);
  });

  it('throws SCREENING_NOT_FOUND for missing', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(updateScreening('missing', { status: 'cancelled' }, db)).rejects.toThrow(CinemaError);
  });
});

// ---------------------------------------------------------------------------
// getAuditorium / listAuditoriums
// ---------------------------------------------------------------------------
describe('getAuditorium', () => {
  it('returns auditorium by id', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [AUDITORIUM_ROW] });
    const r = await getAuditorium('a-1', db);
    expect(r.name).toBe('Hall 1');
  });

  it('throws AUDITORIUM_NOT_FOUND', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getAuditorium('missing', db)).rejects.toThrow(CinemaError);
  });
});

describe('listAuditoriums', () => {
  it('returns auditoriums for venue', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [AUDITORIUM_ROW] });
    const r = await listAuditoriums('v-1', db);
    expect(r).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeScreeningFromProgram
// ---------------------------------------------------------------------------
describe('removeScreeningFromProgram', () => {
  it('deletes program-screening link', async () => {
    const db = makeDb();
    await removeScreeningFromProgram('p-1', 'sc-1', db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE FROM cinema.program_screenings');
  });
});

// ---------------------------------------------------------------------------
// getProgram
// ---------------------------------------------------------------------------
describe('getProgram', () => {
  it('returns program by id', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'p-1', venue_id: 'v-1', week_start: '2026-06-01', published_at: null, notes: null, created_at: '2026-01-01' }],
    });
    const r = await getProgram('p-1', db);
    expect(r.id).toBe('p-1');
  });

  it('throws PROGRAM_NOT_FOUND', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(getProgram('missing', db)).rejects.toThrow(CinemaError);
  });
});

// ---------------------------------------------------------------------------
// searchFilms
// ---------------------------------------------------------------------------
describe('searchFilms', () => {
  it('returns films matching query', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'f-1', title: 'Matrix', original_title: 'The Matrix', duration_minutes: 136,
        director: 'Wachowskis', genre: 'sci-fi', rating: 'B', release_year: 1999,
        poster_url: null, trailer_url: null, description: null, created_at: '2026-01-01' }],
    });
    const r = await searchFilms('p-1', 'matrix', db);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Matrix');
  });

  it('returns empty array for no matches', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    const r = await searchFilms('p-1', 'nonexistent', db);
    expect(r).toEqual([]);
  });

  it('uses ILIKE for case-insensitive search', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await searchFilms('p-1', 'matrix', db);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql.toUpperCase()).toContain('ILIKE');
  });
});

// ---------------------------------------------------------------------------
// updateFilm
// ---------------------------------------------------------------------------
describe('updateFilm', () => {
  it('updates film fields', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'f-1', title: 'New Title', original_title: 'New', duration_minutes: 120,
        director: 'X', genre: 'drama', rating: 'A', release_year: 2026,
        poster_url: null, trailer_url: null, description: null, created_at: '2026-01-01' }],
    });
    const r = await updateFilm('f-1', { title: 'New Title' }, db);
    expect(r.title).toBe('New Title');
  });

  it('throws FILM_NOT_FOUND', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    await expect(updateFilm('missing', { title: 'X' }, db)).rejects.toThrow(CinemaError);
  });
});

// ---------------------------------------------------------------------------
// getAvailableSeats edge cases
// ---------------------------------------------------------------------------
describe('getAvailableSeats — edge cases', () => {
  it('returns all seats when none reserved', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'seat-1', screening_id: 'sc-1', row_number: 1, seat_number: 1, seat_type: 'standard', status: 'available', price_hellers: 25000 },
        { id: 'seat-2', screening_id: 'sc-1', row_number: 1, seat_number: 2, seat_type: 'standard', status: 'available', price_hellers: 25000 },
      ],
    });
    const r = await getAvailableSeats('sc-1', db);
    expect(r).toHaveLength(2);
    expect(r[0].status).toBe('available');
  });
});
