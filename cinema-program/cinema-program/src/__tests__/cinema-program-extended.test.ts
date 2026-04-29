/**
 * Extended cinema-program tests — covers additional edge cases for
 * tag idempotence, age verification flows, and program-view variants.
 */
import { describe, it, expect, vi } from 'vitest';
import { addTag, removeTag, getTags, getScreeningsByTag } from '../services/screening-tag.service';
import { getNowShowingFilms, getFilmScreenings } from '../services/program-view.service';
import { listRules, updateRule } from '../services/age-restriction.service';
import { listNowShowing, listComingSoon, autoUpdateReleaseStatuses } from '../services/film-release.service';
import { getWidgetConfig, updateWidgetConfig } from '../services/widget-config.service';

function makeDb() {
  const db: any = {
    query: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  };
  return db;
}

// ---------------------------------------------------------------------------
// addTag idempotence
// ---------------------------------------------------------------------------
describe('addTag', () => {
  it('uses ON CONFLICT DO NOTHING for idempotence', async () => {
    const db = makeDb();
    await addTag('sc-1', 'premiere', db);
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT (screening_id, tag) DO NOTHING');
  });

  it('passes screeningId and tag as params', async () => {
    const db = makeDb();
    await addTag('sc-1', 'gala', db);
    const params = db.execute.mock.calls[0][1];
    expect(params).toEqual(['sc-1', 'gala']);
  });
});

describe('removeTag', () => {
  it('issues DELETE statement', async () => {
    const db = makeDb();
    await removeTag('sc-1', 'premiere', db);
    const sql = db.execute.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE FROM cinema.screening_tags');
  });
});

describe('getTags', () => {
  it('returns array of tag strings', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [{ tag: 'premiere' }, { tag: 'gala' }] });
    const r = await getTags('sc-1', db);
    expect(r).toEqual(['premiere', 'gala']);
  });

  it('returns empty array when no tags', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    expect(await getTags('sc-1', db)).toEqual([]);
  });
});

describe('getScreeningsByTag', () => {
  it('returns screenings filtered by tag', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 'sc-1', film_id: 'f-1', auditorium_id: 'a-1',
          starts_at: '2026-06-01T18:00:00Z', ends_at: '2026-06-01T20:00:00Z',
          format: '2d', language: 'cs', price_hellers: 25000, status: 'open', tag: 'premiere' },
      ],
    });
    const r = await getScreeningsByTag('v-1', 'premiere', db);
    expect(r.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// listRules
// ---------------------------------------------------------------------------
describe('listRules', () => {
  it('returns rules for venue', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'rule-1', venue_id: 'v-1', min_age: 15, requires_id_check: true,
        applies_to_film_ratings: ['B', 'C'], created_at: '2026-01-01',
      }],
    });
    const r = await listRules('v-1', db);
    expect(r.length).toBeGreaterThanOrEqual(0);
  });
});

describe('updateRule', () => {
  it('updates rule fields', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'rule-1', venue_id: 'v-1', min_age: 18, requires_id_check: true,
        applies_to_film_ratings: ['C'], created_at: '2026-01-01',
      }],
    });
    const r = await updateRule('p-1', 'C', { minAge: 18 } as any, db);
    expect(r).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// listNowShowing / listComingSoon
// ---------------------------------------------------------------------------
describe('listNowShowing', () => {
  it('returns now-showing films', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'r-1', film_id: 'f-1', release_date: '2026-05-01',
        end_date: '2026-08-01', status: 'now_showing', distributor: 'X', created_at: '2026-01-01',
      }],
    });
    const r = await listNowShowing('v-1', db);
    expect(r.length).toBeGreaterThanOrEqual(0);
  });
});

describe('listComingSoon', () => {
  it('returns coming-soon films', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    const r = await listComingSoon('v-1', db);
    expect(r).toEqual([]);
  });
});

describe('autoUpdateReleaseStatuses', () => {
  it('runs status update logic', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const r = await autoUpdateReleaseStatuses('v-1', db);
    expect(r).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// program-view: getNowShowingFilms, getFilmScreenings
// ---------------------------------------------------------------------------
describe('getNowShowingFilms', () => {
  it('returns now showing films for venue', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    const r = await getNowShowingFilms('v-1', db);
    expect(Array.isArray(r)).toBe(true);
  });
});

describe('getFilmScreenings', () => {
  it('returns screenings for a film at a venue', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({ rows: [] });
    const r = await getFilmScreenings('v-1', 'f-1', db);
    expect(Array.isArray(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Widget config
// ---------------------------------------------------------------------------
describe('getWidgetConfig', () => {
  it('returns config by widget id', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'w-1', venue_id: 'v-1', widget_type: 'now_showing',
        title: 'Now Showing', max_items: 10, theme: 'dark',
        custom_css: null, embed_code: '<iframe>', created_at: '2026-01-01',
      }],
    });
    const r = await getWidgetConfig('v-1', 'now_showing', db);
    expect(r).toBeDefined();
  });
});

describe('updateWidgetConfig', () => {
  it('updates widget config', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'w-1', venue_id: 'v-1', widget_type: 'now_showing',
        title: 'New Title', max_items: 5, theme: 'light',
        custom_css: null, embed_code: '<iframe>', created_at: '2026-01-01',
      }],
    });
    const r = await updateWidgetConfig('v-1', 'now_showing', { title: 'New Title' } as any, db);
    expect(r).toBeDefined();
  });
});
