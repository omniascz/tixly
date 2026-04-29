import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CinemaProgramError, isCinemaProgramError } from '../lib/cinema-program-errors';
import {
  createRule,
  getRule,
  listRules,
  updateRule,
  checkAgeForScreening,
  getVerification,
  hasVerification,
  listVerificationsForScreening,
} from '../services/age-restriction.service';
import {
  setRelease,
  getRelease,
  listNowShowing,
  listComingSoon,
  updateReleaseStatus,
  autoUpdateReleaseStatuses,
} from '../services/film-release.service';
import {
  addTag,
  removeTag,
  getTags,
  getScreeningsByTag,
} from '../services/screening-tag.service';
import {
  getPublicProgram,
  getWidgetData,
  getNowShowingFilms,
  getFilmScreenings,
} from '../services/program-view.service';
import {
  createWidgetConfig,
  getWidgetConfig,
  updateWidgetConfig,
} from '../services/widget-config.service';

// ---------------------------------------------------------------------------
// makeDb helper — query() increments index; execute() does NOT
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
const FILM_ID = 'film-uuid-0001';
const SCREENING_ID = 'screening-uuid-0001';
const USER_ID = 'user-uuid-0001';
const AUDITORIUM_ID = 'auditorium-uuid-0001';

const RULE_ROW = {
  id: 'rule-uuid-0001',
  promoter_id: PROMOTER_ID,
  rating: '15+',
  min_age: 15,
  requires_id_check: false,
  description: 'Films rated 15 and above',
  created_at: '2026-04-07T10:00:00.000Z',
};

const VERIFICATION_ROW = {
  id: 'verif-uuid-0001',
  screening_id: SCREENING_ID,
  user_id: USER_ID,
  verified_at: '2026-04-07T10:00:00.000Z',
  method: 'self_declared',
  birth_date: '2000-01-01',
  age_at_verification: 26,
};

const RELEASE_ROW = {
  id: 'release-uuid-0001',
  film_id: FILM_ID,
  venue_id: VENUE_ID,
  release_date: '2026-04-01',
  end_date: '2026-05-01',
  status: 'now_showing',
  poster_override_url: null,
  promo_text: null,
};

const RELEASE_WITH_FILM_ROW = {
  ...RELEASE_ROW,
  film_title: 'Duna: Část druhá',
  film_rating: '12+',
  film_duration_minutes: 166,
  film_genre: 'sci-fi',
  film_poster_url: null,
};

const VENUE_ROW = {
  id: VENUE_ID,
  name: 'Bio Oko',
  city: 'Praha',
};

const SCREENING_JOIN_ROW = {
  id: SCREENING_ID,
  film_id: FILM_ID,
  film_title: 'Duna: Část druhá',
  film_rating: '12+',
  film_duration_minutes: 166,
  film_poster_url: null,
  film_genre: 'sci-fi',
  auditorium_id: AUDITORIUM_ID,
  auditorium_name: 'Sál 1',
  starts_at: '2026-04-07T18:00:00.000Z',
  ends_at: '2026-04-07T20:46:00.000Z',
  format: '2d',
  language: 'cs',
  subtitles: null,
  price_hellers: 25000,
  total_seats: 120,
  seats_sold: 40,
  status: 'open',
};

const WIDGET_CONFIG_ROW = {
  id: 'widget-uuid-0001',
  venue_id: VENUE_ID,
  config_key: 'main',
  days_ahead: 7,
  show_sold_out: true,
  show_prices: true,
  primary_color: '#1a1a2e',
  accent_color: '#e94560',
  custom_css: null,
  created_at: '2026-04-07T10:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests: Age Restriction Rules
// ---------------------------------------------------------------------------

describe('createRule', () => {
  it('1. creates a rule successfully', async () => {
    const db = makeDb([[RULE_ROW]]);
    const rule = await createRule(PROMOTER_ID, '15+', { minAge: 15, description: 'Films rated 15 and above' }, db);

    expect(rule.id).toBe('rule-uuid-0001');
    expect(rule.promoterId).toBe(PROMOTER_ID);
    expect(rule.rating).toBe('15+');
    expect(rule.minAge).toBe(15);
    expect(rule.requiresIdCheck).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('2. createRule — duplicate → RULE_DUPLICATE', async () => {
    // query returns empty rows (simulating unique constraint with no RETURNING)
    const db = makeDb([[]]);
    await expect(createRule(PROMOTER_ID, '15+', { minAge: 15 }, db)).rejects.toThrow(CinemaProgramError);
    try {
      const db2 = makeDb([[]]);
      await createRule(PROMOTER_ID, '15+', { minAge: 15 }, db2);
    } catch (err) {
      expect(isCinemaProgramError(err)).toBe(true);
      expect((err as CinemaProgramError).code).toBe('RULE_DUPLICATE');
    }
  });
});

describe('getRule', () => {
  it('3a. getRule — found', async () => {
    const db = makeDb([[RULE_ROW]]);
    const rule = await getRule(PROMOTER_ID, '15+', db);
    expect(rule).not.toBeNull();
    expect(rule!.rating).toBe('15+');
  });

  it('3b. getRule — not found returns null', async () => {
    const db = makeDb([[]]);
    const rule = await getRule(PROMOTER_ID, '18+', db);
    expect(rule).toBeNull();
  });
});

describe('listRules', () => {
  it('4. listRules — returns array', async () => {
    const rule18 = { ...RULE_ROW, id: 'rule-uuid-0002', rating: '18+', min_age: 18 };
    const db = makeDb([[RULE_ROW, rule18]]);
    const rules = await listRules(PROMOTER_ID, db);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules).toHaveLength(2);
    expect(rules[0].rating).toBe('15+');
    expect(rules[1].rating).toBe('18+');
  });
});

describe('updateRule', () => {
  it('5. updateRule — partial update', async () => {
    const updated = { ...RULE_ROW, requires_id_check: true, description: 'Updated' };
    const db = makeDb([[updated]]);
    const rule = await updateRule(PROMOTER_ID, '15+', { requiresIdCheck: true, description: 'Updated' }, db);
    expect(rule.requiresIdCheck).toBe(true);
    expect(rule.description).toBe('Updated');
  });
});

// ---------------------------------------------------------------------------
// Tests: checkAgeForScreening
// ---------------------------------------------------------------------------

describe('checkAgeForScreening', () => {
  it('6. checkAgeForScreening — passes (age >= minAge) → inserts verification', async () => {
    // Query 1: screening+film rating
    // Query 2: rule lookup
    // execute: insert verification (does NOT increment)
    const db = makeDb([
      [{ film_rating: '15+' }],   // query 1: screening→film rating
      [{ min_age: 15 }],           // query 2: rule
    ]);

    const birthDate = '2000-01-01'; // age ~26 in 2026
    const result = await checkAgeForScreening(SCREENING_ID, USER_ID, birthDate, 'self_declared', db);

    expect(result.allowed).toBe(true);
    expect(result.age).toBeGreaterThanOrEqual(15);
    expect(result.minAge).toBe(15);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('7. checkAgeForScreening — fails (age < minAge) → AGE_TOO_YOUNG', async () => {
    const db = makeDb([
      [{ film_rating: '18+' }],    // query 1: screening→film rating
      [{ min_age: 18 }],            // query 2: rule
    ]);

    const birthDate = '2015-06-15'; // age ~10 in 2026
    await expect(
      checkAgeForScreening(SCREENING_ID, USER_ID, birthDate, 'self_declared', db)
    ).rejects.toThrow(CinemaProgramError);

    try {
      const db2 = makeDb([
        [{ film_rating: '18+' }],
        [{ min_age: 18 }],
      ]);
      await checkAgeForScreening(SCREENING_ID, USER_ID, '2015-06-15', 'self_declared', db2);
    } catch (err) {
      expect((err as CinemaProgramError).code).toBe('AGE_TOO_YOUNG');
    }
  });

  it('8. checkAgeForScreening — no rule for rating → allows (graceful default)', async () => {
    const db = makeDb([
      [{ film_rating: 'R' }],  // query 1: has rating
      [],                       // query 2: no rule found → empty
    ]);

    const birthDate = '2015-01-01'; // underage, but no rule → minAge=0
    const result = await checkAgeForScreening(SCREENING_ID, USER_ID, birthDate, 'self_declared', db);
    expect(result.allowed).toBe(true);
    expect(result.minAge).toBe(0);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: getVerification, hasVerification, listVerificationsForScreening
// ---------------------------------------------------------------------------

describe('getVerification', () => {
  it('9. getVerification — found', async () => {
    const db = makeDb([[VERIFICATION_ROW]]);
    const verif = await getVerification(SCREENING_ID, USER_ID, db);
    expect(verif).not.toBeNull();
    expect(verif!.userId).toBe(USER_ID);
    expect(verif!.method).toBe('self_declared');
  });

  it('10. getVerification — not found returns null', async () => {
    const db = makeDb([[]]);
    const verif = await getVerification(SCREENING_ID, 'other-user', db);
    expect(verif).toBeNull();
  });
});

describe('hasVerification', () => {
  it('11a. hasVerification — true when verification exists', async () => {
    const db = makeDb([[{ exists_flag: '1' }]]);
    const result = await hasVerification(SCREENING_ID, USER_ID, db);
    expect(result).toBe(true);
  });

  it('11b. hasVerification — false when no verification', async () => {
    const db = makeDb([[]]);
    const result = await hasVerification(SCREENING_ID, 'unknown-user', db);
    expect(result).toBe(false);
  });
});

describe('listVerificationsForScreening', () => {
  it('12. listVerificationsForScreening — returns array', async () => {
    const verif2 = { ...VERIFICATION_ROW, id: 'verif-uuid-0002', user_id: 'user-uuid-0002' };
    const db = makeDb([[VERIFICATION_ROW, verif2]]);
    const verifs = await listVerificationsForScreening(SCREENING_ID, db);
    expect(Array.isArray(verifs)).toBe(true);
    expect(verifs).toHaveLength(2);
    expect(verifs[0].screeningId).toBe(SCREENING_ID);
  });
});

// ---------------------------------------------------------------------------
// Tests: Film Releases
// ---------------------------------------------------------------------------

describe('setRelease', () => {
  it('13. setRelease — inserts new release', async () => {
    const db = makeDb([[RELEASE_ROW]]);
    const release = await setRelease(FILM_ID, VENUE_ID, {
      releaseDate: '2026-04-01',
      endDate: '2026-05-01',
      status: 'now_showing',
    }, db);

    expect(release.filmId).toBe(FILM_ID);
    expect(release.venueId).toBe(VENUE_ID);
    expect(release.status).toBe('now_showing');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('14. setRelease — updates existing (UPSERT)', async () => {
    const updatedRow = { ...RELEASE_ROW, promo_text: 'Letní hit!', status: 'now_showing' };
    const db = makeDb([[updatedRow]]);
    const release = await setRelease(FILM_ID, VENUE_ID, {
      releaseDate: '2026-04-01',
      status: 'now_showing',
      promoText: 'Letní hit!',
    }, db);

    expect(release.promoText).toBe('Letní hit!');
    // Only one query call — the UPSERT
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});

describe('getRelease', () => {
  it('15a. getRelease — found', async () => {
    const db = makeDb([[RELEASE_ROW]]);
    const release = await getRelease(FILM_ID, VENUE_ID, db);
    expect(release.filmId).toBe(FILM_ID);
    expect(release.venueId).toBe(VENUE_ID);
  });

  it('15b. getRelease — not found → RELEASE_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getRelease(FILM_ID, VENUE_ID, db)).rejects.toThrow(CinemaProgramError);
    try {
      const db2 = makeDb([[]]);
      await getRelease(FILM_ID, VENUE_ID, db2);
    } catch (err) {
      expect((err as CinemaProgramError).code).toBe('RELEASE_NOT_FOUND');
    }
  });
});

describe('listNowShowing', () => {
  it('16. listNowShowing — returns only now_showing films', async () => {
    const db = makeDb([[RELEASE_WITH_FILM_ROW]]);
    const films = await listNowShowing(VENUE_ID, db);
    expect(films).toHaveLength(1);
    expect(films[0].status).toBe('now_showing');
    expect(films[0].filmTitle).toBe('Duna: Část druhá');
  });
});

describe('listComingSoon', () => {
  it('17. listComingSoon — returns only coming_soon, ordered by date', async () => {
    const row1 = { ...RELEASE_WITH_FILM_ROW, id: 'r1', status: 'coming_soon', release_date: '2026-05-01' };
    const row2 = { ...RELEASE_WITH_FILM_ROW, id: 'r2', status: 'coming_soon', release_date: '2026-06-01', film_title: 'Film B' };
    const db = makeDb([[row1, row2]]);
    const films = await listComingSoon(VENUE_ID, db);
    expect(films).toHaveLength(2);
    expect(films[0].status).toBe('coming_soon');
    expect(films[0].releaseDate).toBe('2026-05-01');
  });
});

describe('updateReleaseStatus', () => {
  it('18. updateReleaseStatus — changes status', async () => {
    const updatedRow = { ...RELEASE_ROW, status: 'ended' };
    const db = makeDb([[updatedRow]]);
    const release = await updateReleaseStatus(FILM_ID, VENUE_ID, 'ended', db);
    expect(release.status).toBe('ended');
  });
});

describe('autoUpdateReleaseStatuses', () => {
  it('19. autoUpdateReleaseStatuses — marks past releases as ended, future as now_showing', async () => {
    // Two queries: one for ended, one for now_showing
    const endedRows = [{ id: 'r1' }, { id: 'r2' }];
    const nowShowingRows = [{ id: 'r3' }];
    const db = makeDb([endedRows, nowShowingRows]);
    const result = await autoUpdateReleaseStatuses(VENUE_ID, db);
    expect(result.updated).toBe(3);
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Screening Tags
// ---------------------------------------------------------------------------

describe('addTag', () => {
  it('20. addTag — valid', async () => {
    const db = makeDb();
    await addTag(SCREENING_ID, 'premiere', db);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cinema.screening_tags'),
      [SCREENING_ID, 'premiere'],
    );
  });

  it('21. addTag — duplicate is idempotent (no error)', async () => {
    const db = makeDb();
    // Call twice — should not throw
    await addTag(SCREENING_ID, 'premiere', db);
    await addTag(SCREENING_ID, 'premiere', db);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});

describe('removeTag', () => {
  it('22. removeTag — removes tag', async () => {
    const db = makeDb();
    await removeTag(SCREENING_ID, 'premiere', db);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM cinema.screening_tags'),
      [SCREENING_ID, 'premiere'],
    );
  });
});

describe('getTags', () => {
  it('23. getTags — returns array of tags', async () => {
    const db = makeDb([[{ tag: 'premiere' }, { tag: 'subtitled' }]]);
    const tags = await getTags(SCREENING_ID, db);
    expect(tags).toEqual(['premiere', 'subtitled']);
  });
});

describe('getScreeningsByTag', () => {
  it('24. getScreeningsByTag — returns screenings with tag', async () => {
    const row = {
      id: SCREENING_ID,
      film_id: FILM_ID,
      auditorium_id: AUDITORIUM_ID,
      starts_at: '2026-04-07T18:00:00.000Z',
      ends_at: '2026-04-07T20:46:00.000Z',
      format: '2d',
      language: 'cs',
      price_hellers: 25000,
      status: 'open',
      tag: 'premiere',
    };
    const db = makeDb([[row]]);
    const screenings = await getScreeningsByTag(VENUE_ID, 'premiere', db);
    expect(screenings).toHaveLength(1);
    expect(screenings[0].id).toBe(SCREENING_ID);
    expect(screenings[0].tags).toContain('premiere');
  });
});

// ---------------------------------------------------------------------------
// Tests: Public Program
// ---------------------------------------------------------------------------

describe('getPublicProgram', () => {
  it('25. getPublicProgram — returns structured days with screenings', async () => {
    // Query 1: venue, Query 2: screenings, Query 3: tags
    const db = makeDb([
      [VENUE_ROW],                         // query 1: venue
      [SCREENING_JOIN_ROW],                // query 2: screenings
      [{ screening_id: SCREENING_ID, tag: 'subtitled' }], // query 3: tags
    ]);

    const program = await getPublicProgram(
      VENUE_ID,
      '2026-04-07T00:00:00.000Z',
      '2026-04-14T00:00:00.000Z',
      db,
    );

    expect(program.venue.id).toBe(VENUE_ID);
    expect(program.venue.name).toBe('Bio Oko');
    expect(program.days).toHaveLength(1);
    expect(program.days[0].date).toBe('2026-04-07');
    expect(program.days[0].screenings).toHaveLength(1);

    const screening = program.days[0].screenings[0];
    expect(screening.id).toBe(SCREENING_ID);
    expect(screening.film.title).toBe('Duna: Část druhá');
    expect(screening.film.rating).toBe('12+');
    expect(screening.auditorium.name).toBe('Sál 1');
    expect(screening.priceHellers).toBe(25000);
    expect(screening.seatsAvailable).toBe(80); // 120 - 40
    expect(screening.tags).toContain('subtitled');
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  it('26. getPublicProgram — empty date range returns empty days array', async () => {
    const db = makeDb([
      [VENUE_ROW],  // query 1: venue
      [],            // query 2: no screenings
    ]);

    const program = await getPublicProgram(
      VENUE_ID,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T23:59:59.000Z',
      db,
    );

    expect(program.venue.id).toBe(VENUE_ID);
    expect(program.days).toHaveLength(0);
    // query 3 (tags) should NOT be called when no screenings
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: getWidgetData
// ---------------------------------------------------------------------------

describe('getWidgetData', () => {
  it('27. getWidgetData — applies show_sold_out=false filter', async () => {
    const soldOutScreening = {
      ...SCREENING_JOIN_ROW,
      id: 'sold-out-screening',
      status: 'sold_out',
      seats_sold: 120,
    };
    const configNoSoldOut = { ...WIDGET_CONFIG_ROW, show_sold_out: false };

    const db = makeDb([
      [configNoSoldOut],                    // query 1: widget config
      [VENUE_ROW],                          // query 2: venue (getPublicProgram)
      [SCREENING_JOIN_ROW, soldOutScreening], // query 3: screenings
      [],                                    // query 4: tags
    ]);

    const program = await getWidgetData(VENUE_ID, 'main', db);
    // sold_out screening should be filtered out
    const allScreenings = program.days.flatMap((d) => d.screenings);
    expect(allScreenings.every((s) => s.status !== 'sold_out')).toBe(true);
    // Only the open screening should remain
    expect(allScreenings).toHaveLength(1);
    expect(allScreenings[0].id).toBe(SCREENING_ID);
  });

  it('28. getWidgetData — applies show_prices=false (prices nulled out)', async () => {
    const configNoPrices = { ...WIDGET_CONFIG_ROW, show_prices: false };

    const db = makeDb([
      [configNoPrices],       // query 1: widget config
      [VENUE_ROW],            // query 2: venue
      [SCREENING_JOIN_ROW],   // query 3: screenings
      [],                      // query 4: tags
    ]);

    const program = await getWidgetData(VENUE_ID, 'main', db);
    const allScreenings = program.days.flatMap((d) => d.screenings);
    expect(allScreenings.length).toBeGreaterThan(0);
    expect(allScreenings.every((s) => s.priceHellers === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: getNowShowingFilms, getFilmScreenings
// ---------------------------------------------------------------------------

describe('getNowShowingFilms', () => {
  it('29. getNowShowingFilms — returns distinct films', async () => {
    const nowShowingRow = {
      film_id: FILM_ID,
      film_title: 'Duna: Část druhá',
      film_rating: '12+',
      film_duration_minutes: 166,
      film_poster_url: null,
      film_genre: 'sci-fi',
      release_date: '2026-04-01',
      next_screening_at: '2026-04-07T18:00:00.000Z',
    };
    const db = makeDb([[nowShowingRow]]);
    const films = await getNowShowingFilms(VENUE_ID, db);
    expect(films).toHaveLength(1);
    expect(films[0].filmId).toBe(FILM_ID);
    expect(films[0].title).toBe('Duna: Část druhá');
    expect(films[0].nextScreeningAt).toBe('2026-04-07T18:00:00.000Z');
  });
});

describe('getFilmScreenings', () => {
  it('30. getFilmScreenings — returns upcoming screenings for film at venue', async () => {
    // Query 1: screenings, Query 2: tags
    const db = makeDb([
      [SCREENING_JOIN_ROW],                         // query 1: screenings
      [{ screening_id: SCREENING_ID, tag: 'dubbed' }], // query 2: tags
    ]);

    const screenings = await getFilmScreenings(VENUE_ID, FILM_ID, db);
    expect(screenings).toHaveLength(1);
    expect(screenings[0].id).toBe(SCREENING_ID);
    expect(screenings[0].film.id).toBe(FILM_ID);
    expect(screenings[0].tags).toContain('dubbed');
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: Widget Config
// ---------------------------------------------------------------------------

describe('createWidgetConfig', () => {
  it('31. createWidgetConfig — valid', async () => {
    const db = makeDb([[WIDGET_CONFIG_ROW]]);
    const config = await createWidgetConfig(VENUE_ID, 'main', {
      daysAhead: 7,
      showSoldOut: true,
      showPrices: true,
    }, db);

    expect(config.venueId).toBe(VENUE_ID);
    expect(config.configKey).toBe('main');
    expect(config.daysAhead).toBe(7);
    expect(config.primaryColor).toBe('#1a1a2e');
    expect(config.accentColor).toBe('#e94560');
  });
});

describe('getWidgetConfig', () => {
  it('32a. getWidgetConfig — found', async () => {
    const db = makeDb([[WIDGET_CONFIG_ROW]]);
    const config = await getWidgetConfig(VENUE_ID, 'main', db);
    expect(config.configKey).toBe('main');
    expect(config.showPrices).toBe(true);
  });

  it('32b. getWidgetConfig — not found → WIDGET_CONFIG_NOT_FOUND', async () => {
    const db = makeDb([[]]);
    await expect(getWidgetConfig(VENUE_ID, 'nonexistent', db)).rejects.toThrow(CinemaProgramError);
    try {
      const db2 = makeDb([[]]);
      await getWidgetConfig(VENUE_ID, 'nonexistent', db2);
    } catch (err) {
      expect((err as CinemaProgramError).code).toBe('WIDGET_CONFIG_NOT_FOUND');
    }
  });
});

describe('updateWidgetConfig', () => {
  it('33. updateWidgetConfig — partial update', async () => {
    const updated = { ...WIDGET_CONFIG_ROW, days_ahead: 14, show_sold_out: false };
    const db = makeDb([[updated]]);
    const config = await updateWidgetConfig(VENUE_ID, 'main', { daysAhead: 14, showSoldOut: false }, db);
    expect(config.daysAhead).toBe(14);
    expect(config.showSoldOut).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 34: Full integration flow
// ---------------------------------------------------------------------------

describe('Full flow: rule → film → release → screening → tag → age check → public program', () => {
  it('34. end-to-end flow produces correct results at each step', async () => {
    // Step 1: createRule
    const dbRule = makeDb([[RULE_ROW]]);
    const rule = await createRule(PROMOTER_ID, '15+', { minAge: 15 }, dbRule);
    expect(rule.minAge).toBe(15);

    // Step 2: setRelease
    const dbRelease = makeDb([[RELEASE_ROW]]);
    const release = await setRelease(FILM_ID, VENUE_ID, {
      releaseDate: '2026-04-01',
      status: 'now_showing',
    }, dbRelease);
    expect(release.status).toBe('now_showing');

    // Step 3: addTag
    const dbTag = makeDb();
    await addTag(SCREENING_ID, 'gala', dbTag);
    expect(dbTag.execute).toHaveBeenCalledTimes(1);

    // Step 4: age check — user born 2000, film rated 15+ → allowed
    const dbAge = makeDb([
      [{ film_rating: '15+' }],
      [{ min_age: 15 }],
    ]);
    const ageResult = await checkAgeForScreening(
      SCREENING_ID, USER_ID, '2000-03-15', 'bankid', dbAge,
    );
    expect(ageResult.allowed).toBe(true);
    expect(ageResult.age).toBeGreaterThanOrEqual(15);

    // Step 5: public program check
    const dbProgram = makeDb([
      [VENUE_ROW],
      [SCREENING_JOIN_ROW],
      [{ screening_id: SCREENING_ID, tag: 'gala' }],
    ]);
    const program = await getPublicProgram(
      VENUE_ID,
      '2026-04-07T00:00:00.000Z',
      '2026-04-08T00:00:00.000Z',
      dbProgram,
    );
    expect(program.days).toHaveLength(1);
    const sc = program.days[0].screenings[0];
    expect(sc.tags).toContain('gala');
    expect(sc.film.rating).toBe('12+');
    expect(sc.seatsAvailable).toBe(80);
  });
});
