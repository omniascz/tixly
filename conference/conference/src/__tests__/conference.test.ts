// =============================================================================
// Conference module — comprehensive test suite (32+ tests)
// Uses makeDb() mock pattern: query() increments index, execute() does not
// =============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createConference,
  getConference,
  addDay,
  addTrack,
  getSchedule,
  type ConferenceDB,
} from '../services/conference.service';

import {
  createSpeaker,
  getSpeaker,
  listSpeakers,
  updateSpeaker,
  assignSpeakerToSession,
  removeSpeakerFromSession,
  type SpeakerDB,
} from '../services/speaker.service';

import {
  createSession,
  getSession,
  updateSession,
  listSessions,
  deleteSession,
  type SessionDB,
} from '../services/session.service';

import {
  createPass,
  getPass,
  listPasses,
  activatePass,
  getActivationsForUser,
  checkPassAccess,
  type PassDB,
} from '../services/pass.service';

import { ConferenceError } from '../lib/conference-errors';

import { POST as createSessionRoute } from '../app/api/conferences/[conferenceId]/sessions/route';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// makeDb helper
// ---------------------------------------------------------------------------

function makeDb(responses: unknown[] = []) {
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: responses[i++] ?? [] })),
    execute: vi.fn(async () => {}),
  };
}

// The services expect db.query to return T[] directly (not { rows: T[] })
// We use a proper makeDb that matches the service interface:
function makeServiceDb(responses: unknown[][] = []) {
  let i = 0;
  return {
    query: vi.fn(async <T>(): Promise<T[]> => (responses[i++] ?? []) as T[]),
    execute: vi.fn(async (): Promise<void> => {}),
  };
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const CONF_ROW = {
  id: 'conf-1',
  event_id: 'event-1',
  subtitle: 'The best conference',
  venue_map_url: null,
  website_url: 'https://example.com',
  code_of_conduct_url: null,
  language: 'cs',
  timezone: 'Europe/Prague',
  created_at: '2026-04-07T00:00:00Z',
};

const CONF_STATS_ROW = {
  ...CONF_ROW,
  days_count: '2',
  sessions_count: '5',
};

const DAY_ROW = {
  id: 'day-1',
  conference_id: 'conf-1',
  day_date: '2026-10-01',
  label: 'Den 1',
  description: null,
  sort_order: 0,
};

const TRACK_ROW = {
  id: 'track-1',
  conference_id: 'conf-1',
  name: 'Main Stage',
  color: '#FF5733',
  description: null,
  sort_order: 0,
};

const SESSION_ROW = {
  id: 'session-1',
  conference_id: 'conf-1',
  day_id: 'day-1',
  track_id: 'track-1',
  title: 'Opening Keynote',
  description: 'Welcome to the conference',
  session_type: 'keynote',
  starts_at: '2026-10-01T09:00:00Z',
  ends_at: '2026-10-01T10:00:00Z',
  room: 'Main Hall',
  capacity: 500,
  is_recorded: true,
  slides_url: null,
  video_url: null,
  sort_order: 0,
};

const SPEAKER_ROW = {
  id: 'speaker-1',
  promoter_id: 'promo-1',
  full_name: 'Jane Doe',
  bio: 'Developer and speaker',
  photo_url: null,
  company: 'Acme Corp',
  title: 'Senior Engineer',
  linkedin_url: null,
  twitter_handle: '@janedoe',
  website_url: null,
  created_at: '2026-04-07T00:00:00Z',
};

const PASS_ROW = {
  id: 'pass-1',
  event_id: 'event-1',
  name: 'Full Conference Pass',
  description: 'Access to all days',
  pass_type: 'full',
  days_included: [1, 2, 3],
  tracks_included: null,
  price_hellers: 500000,
  sale_start: '2026-01-01T00:00:00Z',
  sale_end: '2099-12-31T23:59:59Z',
  quantity: 100,
  quantity_sold: 0,
  status: 'active',
  created_at: '2026-04-07T00:00:00Z',
};

const ACTIVATION_ROW = {
  id: 'activation-1',
  pass_id: 'pass-1',
  user_id: 'user-1',
  order_id: 'order-1',
  activated_at: '2026-04-07T00:00:00Z',
  access_token: 'token-uuid-1234',
};

// ---------------------------------------------------------------------------
// 1. createConference — valid input
// ---------------------------------------------------------------------------

describe('createConference', () => {
  it('1. creates conference and returns record', async () => {
    const db = makeServiceDb([[CONF_ROW]]);
    const result = await createConference(
      { eventId: 'event-1', subtitle: 'The best conference', websiteUrl: 'https://example.com' },
      db as unknown as ConferenceDB,
    );
    expect(result.id).toBe('conf-1');
    expect(result.eventId).toBe('event-1');
    expect(result.subtitle).toBe('The best conference');
    expect(result.language).toBe('cs');
    expect(result.timezone).toBe('Europe/Prague');
    expect(db.query).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 2. getConference — found / not found
// ---------------------------------------------------------------------------

describe('getConference', () => {
  it('2. returns conference with stats when found', async () => {
    const db = makeServiceDb([[CONF_STATS_ROW]]);
    const result = await getConference('conf-1', db as unknown as ConferenceDB);
    expect(result.id).toBe('conf-1');
    expect(result.daysCount).toBe(2);
    expect(result.sessionsCount).toBe(5);
  });

  it('3. throws CONFERENCE_NOT_FOUND when not found', async () => {
    const db = makeServiceDb([[]]); // empty result
    await expect(getConference('nope', db as unknown as ConferenceDB))
      .rejects.toThrow(ConferenceError);
    try {
      await getConference('nope', makeServiceDb([[]]) as unknown as ConferenceDB);
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('CONFERENCE_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. addDay — valid
// ---------------------------------------------------------------------------

describe('addDay', () => {
  it('4. adds a day and returns it', async () => {
    const db = makeServiceDb([[DAY_ROW]]);
    const result = await addDay(
      'conf-1',
      { dayDate: '2026-10-01', label: 'Den 1', sortOrder: 0 },
      db as unknown as ConferenceDB,
    );
    expect(result.id).toBe('day-1');
    expect(result.conferenceId).toBe('conf-1');
    expect(result.label).toBe('Den 1');
    expect(result.dayDate).toBe('2026-10-01');
  });
});

// ---------------------------------------------------------------------------
// 4. addTrack — valid
// ---------------------------------------------------------------------------

describe('addTrack', () => {
  it('5. adds a track and returns it', async () => {
    const db = makeServiceDb([[TRACK_ROW]]);
    const result = await addTrack(
      'conf-1',
      { name: 'Main Stage', color: '#FF5733' },
      db as unknown as ConferenceDB,
    );
    expect(result.id).toBe('track-1');
    expect(result.name).toBe('Main Stage');
    expect(result.color).toBe('#FF5733');
  });
});

// ---------------------------------------------------------------------------
// 5. getSchedule — returns days with sessions and speakers
// ---------------------------------------------------------------------------

describe('getSchedule', () => {
  it('6. returns schedule with days, sessions and speakers', async () => {
    const sessionWithSpeakers = {
      ...SESSION_ROW,
      speakers: JSON.stringify([
        { id: 'speaker-1', fullName: 'Jane Doe', role: 'speaker', sortOrder: 0 },
      ]),
    };

    const db = makeServiceDb([
      [CONF_ROW],           // conference
      [DAY_ROW],            // days
      [sessionWithSpeakers], // sessions with speakers
    ]);

    const schedule = await getSchedule('conf-1', db as unknown as ConferenceDB);
    expect(schedule.id).toBe('conf-1');
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].label).toBe('Den 1');
    expect(schedule.days[0].sessions).toHaveLength(1);
    expect(schedule.days[0].sessions[0].title).toBe('Opening Keynote');
    expect(schedule.days[0].sessions[0].speakers).toHaveLength(1);
    expect(schedule.days[0].sessions[0].speakers[0].fullName).toBe('Jane Doe');
  });

  it('7. throws CONFERENCE_NOT_FOUND when conference missing', async () => {
    const db = makeServiceDb([[]]); // no conference
    await expect(getSchedule('nope', db as unknown as ConferenceDB))
      .rejects.toThrow(ConferenceError);
  });
});

// ---------------------------------------------------------------------------
// 6-10. Speaker service
// ---------------------------------------------------------------------------

describe('createSpeaker', () => {
  it('8. creates speaker and returns record', async () => {
    const db = makeServiceDb([[SPEAKER_ROW]]);
    const result = await createSpeaker(
      'promo-1',
      { fullName: 'Jane Doe', company: 'Acme Corp', title: 'Senior Engineer', twitterHandle: '@janedoe' },
      db as unknown as SpeakerDB,
    );
    expect(result.id).toBe('speaker-1');
    expect(result.fullName).toBe('Jane Doe');
    expect(result.promoterId).toBe('promo-1');
    expect(result.twitterHandle).toBe('@janedoe');
  });

  it('9. throws SPEAKER_DUPLICATE on unique violation', async () => {
    const pgError = Object.assign(new Error('unique violation'), { code: '23505' });
    const db = {
      query: vi.fn().mockRejectedValue(pgError),
      execute: vi.fn(),
    };
    try {
      await createSpeaker('promo-1', { fullName: 'Jane Doe' }, db as unknown as SpeakerDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('SPEAKER_DUPLICATE');
    }
  });
});

describe('getSpeaker', () => {
  it('10. returns speaker when found', async () => {
    const db = makeServiceDb([[SPEAKER_ROW]]);
    const result = await getSpeaker('speaker-1', db as unknown as SpeakerDB);
    expect(result.id).toBe('speaker-1');
    expect(result.fullName).toBe('Jane Doe');
  });

  it('11. throws SPEAKER_NOT_FOUND when missing', async () => {
    const db = makeServiceDb([[]]);
    try {
      await getSpeaker('nope', db as unknown as SpeakerDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('SPEAKER_NOT_FOUND');
    }
  });
});

describe('listSpeakers', () => {
  it('12. returns array of speakers', async () => {
    const db = makeServiceDb([[SPEAKER_ROW, { ...SPEAKER_ROW, id: 'speaker-2', full_name: 'John Smith' }]]);
    const result = await listSpeakers('promo-1', db as unknown as SpeakerDB);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('speaker-1');
    expect(result[1].id).toBe('speaker-2');
  });
});

describe('updateSpeaker', () => {
  it('13. partial update returns updated speaker', async () => {
    const updatedRow = { ...SPEAKER_ROW, company: 'New Corp' };
    const db = makeServiceDb([[updatedRow]]);
    const result = await updateSpeaker(
      'speaker-1',
      { company: 'New Corp' },
      db as unknown as SpeakerDB,
    );
    expect(result.company).toBe('New Corp');
    expect(result.id).toBe('speaker-1');
  });
});

describe('assignSpeakerToSession / removeSpeakerFromSession', () => {
  it('14. assignSpeakerToSession returns assignment', async () => {
    const assignmentRow = {
      id: 'assignment-1',
      session_id: 'session-1',
      speaker_id: 'speaker-1',
      role: 'speaker',
      sort_order: 0,
    };
    const db = makeServiceDb([[assignmentRow]]);
    const result = await assignSpeakerToSession(
      'session-1', 'speaker-1', 'speaker', 0,
      db as unknown as SpeakerDB,
    );
    expect(result.id).toBe('assignment-1');
    expect(result.role).toBe('speaker');
    expect(result.sessionId).toBe('session-1');
    expect(result.speakerId).toBe('speaker-1');
  });

  it('15. removeSpeakerFromSession calls execute', async () => {
    const db = makeServiceDb([]);
    await removeSpeakerFromSession('session-1', 'speaker-1', db as unknown as SpeakerDB);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['session-1', 'speaker-1'],
    );
  });
});

// ---------------------------------------------------------------------------
// 11-15. Session service
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('16. creates session with valid times', async () => {
    const db = makeServiceDb([[SESSION_ROW]]);
    const result = await createSession('conf-1', {
      dayId: 'day-1',
      trackId: 'track-1',
      title: 'Opening Keynote',
      sessionType: 'keynote',
      startsAt: '2026-10-01T09:00:00Z',
      endsAt: '2026-10-01T10:00:00Z',
      room: 'Main Hall',
      capacity: 500,
      isRecorded: true,
    }, db as unknown as SessionDB);
    expect(result.id).toBe('session-1');
    expect(result.sessionType).toBe('keynote');
    expect(result.isRecorded).toBe(true);
  });

  it('17. throws INVALID_SESSION_TYPE when ends_at <= starts_at', async () => {
    const db = makeServiceDb([]);
    try {
      await createSession('conf-1', {
        dayId: 'day-1',
        title: 'Bad Session',
        sessionType: 'talk',
        startsAt: '2026-10-01T10:00:00Z',
        endsAt: '2026-10-01T09:00:00Z', // before start!
      }, db as unknown as SessionDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError).toBe(true);
    }
  });

  it('18. throws when ends_at equals starts_at', async () => {
    const db = makeServiceDb([]);
    await expect(createSession('conf-1', {
      dayId: 'day-1',
      title: 'Zero Duration',
      sessionType: 'break',
      startsAt: '2026-10-01T09:00:00Z',
      endsAt: '2026-10-01T09:00:00Z',
    }, db as unknown as SessionDB)).rejects.toBeInstanceOf(ConferenceError);
  });
});

describe('getSession', () => {
  it('19. returns session with speakers', async () => {
    const speakerRow = {
      id: 'speaker-1',
      full_name: 'Jane Doe',
      role: 'speaker',
      sort_order: 0,
    };
    const db = makeServiceDb([[SESSION_ROW], [speakerRow]]);
    const result = await getSession('session-1', db as unknown as SessionDB);
    expect(result.id).toBe('session-1');
    expect(result.speakers).toHaveLength(1);
    expect(result.speakers[0].fullName).toBe('Jane Doe');
    expect(result.speakers[0].role).toBe('speaker');
  });

  it('20. throws SESSION_NOT_FOUND when missing', async () => {
    const db = makeServiceDb([[]]);
    try {
      await getSession('nope', db as unknown as SessionDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('SESSION_NOT_FOUND');
    }
  });
});

describe('updateSession', () => {
  it('21. partial update returns updated session', async () => {
    const updatedRow = { ...SESSION_ROW, room: 'Room B', title: 'Updated Keynote' };
    const db = makeServiceDb([[updatedRow]]);
    const result = await updateSession('session-1', { room: 'Room B', title: 'Updated Keynote' }, db as unknown as SessionDB);
    expect(result.room).toBe('Room B');
    expect(result.title).toBe('Updated Keynote');
  });
});

describe('listSessions', () => {
  it('22. filter by day_id', async () => {
    const db = makeServiceDb([[SESSION_ROW]]);
    const result = await listSessions('conf-1', { dayId: 'day-1' }, db as unknown as SessionDB);
    expect(result).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('day_id'),
      expect.arrayContaining(['day-1']),
    );
  });

  it('23. filter by track_id', async () => {
    const db = makeServiceDb([[SESSION_ROW]]);
    const result = await listSessions('conf-1', { trackId: 'track-1' }, db as unknown as SessionDB);
    expect(result).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('track_id'),
      expect.arrayContaining(['track-1']),
    );
  });

  it('24. filter by session_type', async () => {
    const db = makeServiceDb([[SESSION_ROW]]);
    const result = await listSessions('conf-1', { sessionType: 'keynote' }, db as unknown as SessionDB);
    expect(result).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('session_type'),
      expect.arrayContaining(['keynote']),
    );
  });
});

describe('deleteSession', () => {
  it('25. delete calls execute', async () => {
    const db = makeServiceDb([]);
    await deleteSession('session-1', db as unknown as SessionDB);
    expect(db.execute).toHaveBeenCalledOnce();
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('DELETE'),
      ['session-1'],
    );
  });
});

// ---------------------------------------------------------------------------
// 16-22. Pass service
// ---------------------------------------------------------------------------

describe('createPass', () => {
  const passCases: Array<{ type: 'full' | 'day' | 'track' | 'workshop'; label: string }> = [
    { type: 'full', label: 'full pass' },
    { type: 'day', label: 'day pass' },
    { type: 'track', label: 'track pass' },
    { type: 'workshop', label: 'workshop pass' },
  ];

  passCases.forEach(({ type, label }) => {
    it(`26-${type}. creates ${label}`, async () => {
      const passRow = { ...PASS_ROW, pass_type: type, id: `pass-${type}` };
      const db = makeServiceDb([[passRow]]);
      const result = await createPass('event-1', {
        name: `${label}`,
        passType: type,
        daysIncluded: [1, 2],
        priceHellers: 500000,
        status: 'active',
      }, db as unknown as PassDB);
      expect(result.passType).toBe(type);
      expect(result.priceHellers).toBe(500000);
    });
  });
});

describe('getPass', () => {
  it('27. returns pass when found', async () => {
    const db = makeServiceDb([[PASS_ROW]]);
    const result = await getPass('pass-1', db as unknown as PassDB);
    expect(result.id).toBe('pass-1');
    expect(result.name).toBe('Full Conference Pass');
    expect(result.priceHellers).toBe(500000);
  });

  it('28. throws PASS_NOT_FOUND when missing', async () => {
    const db = makeServiceDb([[]]);
    try {
      await getPass('nope', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_NOT_FOUND');
    }
  });
});

describe('listPasses', () => {
  it('29. returns array of passes', async () => {
    const db = makeServiceDb([[PASS_ROW, { ...PASS_ROW, id: 'pass-2', name: 'Day Pass' }]]);
    const result = await listPasses('event-1', db as unknown as PassDB);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('pass-1');
  });
});

// ---------------------------------------------------------------------------
// activatePass
// ---------------------------------------------------------------------------

describe('activatePass', () => {
  it('30. success — returns activation with access_token', async () => {
    const db = makeServiceDb([
      [PASS_ROW],       // load pass
      [],               // no existing activation
      [ACTIVATION_ROW], // insert activation
    ]);
    const result = await activatePass('pass-1', 'user-1', 'order-1', db as unknown as PassDB);
    expect(result.accessToken).toBe('token-uuid-1234');
    expect(result.passId).toBe('pass-1');
    expect(result.userId).toBe('user-1');
    expect(db.execute).toHaveBeenCalledOnce(); // quantity_sold++
  });

  it('31. throws PASS_SOLD_OUT when status=sold_out', async () => {
    const soldOutPass = { ...PASS_ROW, status: 'sold_out' };
    const db = makeServiceDb([[soldOutPass]]);
    try {
      await activatePass('pass-1', 'user-1', 'order-1', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_SOLD_OUT');
    }
  });

  it('32. throws PASS_SALE_CLOSED when status=draft', async () => {
    const draftPass = { ...PASS_ROW, status: 'draft' };
    const db = makeServiceDb([[draftPass]]);
    try {
      await activatePass('pass-1', 'user-1', 'order-1', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_SALE_CLOSED');
    }
  });

  it('33. throws PASS_SALE_CLOSED when sale window not open (future start)', async () => {
    const futurePass = {
      ...PASS_ROW,
      sale_start: '2099-01-01T00:00:00Z',
      sale_end: '2099-12-31T23:59:59Z',
    };
    const db = makeServiceDb([[futurePass]]);
    try {
      await activatePass('pass-1', 'user-1', 'order-1', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_SALE_CLOSED');
    }
  });

  it('34. throws PASS_ALREADY_ACTIVATED when already activated', async () => {
    const db = makeServiceDb([
      [PASS_ROW],             // load pass
      [{ id: 'activation-1' }], // existing activation found
    ]);
    try {
      await activatePass('pass-1', 'user-1', 'order-1', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_ALREADY_ACTIVATED');
    }
  });

  it('35. throws PASS_SOLD_OUT when quantity exhausted', async () => {
    const fullPass = { ...PASS_ROW, quantity: 10, quantity_sold: 10 };
    const db = makeServiceDb([[fullPass]]);
    try {
      await activatePass('pass-1', 'user-1', 'order-1', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_SOLD_OUT');
    }
  });
});

// ---------------------------------------------------------------------------
// getActivationsForUser
// ---------------------------------------------------------------------------

describe('getActivationsForUser', () => {
  it('36. returns list of user activations with pass details', async () => {
    const activationWithPass = {
      ...ACTIVATION_ROW,
      pass_name: 'Full Conference Pass',
      pass_type: 'full',
      event_id: 'event-1',
      days_included: [1, 2, 3],
      tracks_included: null,
      price_hellers: 500000,
      sale_start: null,
      sale_end: null,
      quantity: 100,
      quantity_sold: 1,
      pass_status: 'active',
      pass_created_at: '2026-04-07T00:00:00Z',
      pass_description: 'Access to all days',
    };
    const db = makeServiceDb([[activationWithPass]]);
    const result = await getActivationsForUser('user-1', db as unknown as PassDB);
    expect(result).toHaveLength(1);
    expect(result[0].passId).toBe('pass-1');
    expect(result[0].pass.name).toBe('Full Conference Pass');
    expect(result[0].pass.daysIncluded).toEqual([1, 2, 3]);
    expect(result[0].accessToken).toBe('token-uuid-1234');
  });
});

// ---------------------------------------------------------------------------
// checkPassAccess
// ---------------------------------------------------------------------------

describe('checkPassAccess', () => {
  it('37. valid token returns pass + activation', async () => {
    const row = {
      ...ACTIVATION_ROW,
      pass_name: 'Full Conference Pass',
      pass_type: 'full',
      event_id: 'event-1',
      days_included: [1, 2, 3],
      tracks_included: null,
      price_hellers: 500000,
      sale_start: null,
      sale_end: null,
      quantity: 100,
      quantity_sold: 1,
      pass_status: 'active',
      pass_created_at: '2026-04-07T00:00:00Z',
      pass_description: null,
    };
    const db = makeServiceDb([[row]]);
    const result = await checkPassAccess('token-uuid-1234', db as unknown as PassDB);
    expect(result.activation.accessToken).toBe('token-uuid-1234');
    expect(result.pass.name).toBe('Full Conference Pass');
    expect(result.pass.daysIncluded).toEqual([1, 2, 3]);
  });

  it('38. invalid token throws PASS_NOT_FOUND', async () => {
    const db = makeServiceDb([[]]);
    try {
      await checkPassAccess('bad-token', db as unknown as PassDB);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err instanceof ConferenceError && err.code).toBe('PASS_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// 39. Full integration flow test
// ---------------------------------------------------------------------------

describe('Full flow: conference → day → track → session → speaker → assign → pass → activate → checkAccess', () => {
  it('39. end-to-end happy path', async () => {
    // Step 1: Create conference
    const confDb = makeServiceDb([[CONF_ROW]]);
    const conf = await createConference({ eventId: 'event-1' }, confDb as unknown as ConferenceDB);
    expect(conf.id).toBe('conf-1');

    // Step 2: Add day
    const dayDb = makeServiceDb([[DAY_ROW]]);
    const day = await addDay('conf-1', { dayDate: '2026-10-01', label: 'Den 1' }, dayDb as unknown as ConferenceDB);
    expect(day.id).toBe('day-1');

    // Step 3: Add track
    const trackDb = makeServiceDb([[TRACK_ROW]]);
    const track = await addTrack('conf-1', { name: 'Main Stage' }, trackDb as unknown as ConferenceDB);
    expect(track.id).toBe('track-1');

    // Step 4: Create session
    const sessionDb = makeServiceDb([[SESSION_ROW]]);
    const session = await createSession('conf-1', {
      dayId: 'day-1',
      trackId: 'track-1',
      title: 'Opening Keynote',
      sessionType: 'keynote',
      startsAt: '2026-10-01T09:00:00Z',
      endsAt: '2026-10-01T10:00:00Z',
    }, sessionDb as unknown as SessionDB);
    expect(session.id).toBe('session-1');

    // Step 5: Create speaker
    const speakerDb = makeServiceDb([[SPEAKER_ROW]]);
    const speaker = await createSpeaker('promo-1', { fullName: 'Jane Doe' }, speakerDb as unknown as SpeakerDB);
    expect(speaker.id).toBe('speaker-1');

    // Step 6: Assign speaker
    const assignRow = { id: 'assign-1', session_id: 'session-1', speaker_id: 'speaker-1', role: 'speaker', sort_order: 0 };
    const assignDb = makeServiceDb([[assignRow]]);
    const assignment = await assignSpeakerToSession('session-1', 'speaker-1', 'speaker', 0, assignDb as unknown as SpeakerDB);
    expect(assignment.role).toBe('speaker');

    // Step 7: Create pass
    const passDb = makeServiceDb([[PASS_ROW]]);
    const pass = await createPass('event-1', {
      name: 'Full Conference Pass',
      passType: 'full',
      daysIncluded: [1, 2, 3],
      priceHellers: 500000,
      status: 'active',
    }, passDb as unknown as PassDB);
    expect(pass.id).toBe('pass-1');

    // Step 8: Activate pass
    const activateDb = makeServiceDb([
      [PASS_ROW],
      [],
      [ACTIVATION_ROW],
    ]);
    const activation = await activatePass('pass-1', 'user-1', 'order-1', activateDb as unknown as PassDB);
    expect(activation.accessToken).toBe('token-uuid-1234');

    // Step 9: Check access
    const checkRow = {
      ...ACTIVATION_ROW,
      pass_name: 'Full Conference Pass',
      pass_type: 'full',
      event_id: 'event-1',
      days_included: [1, 2, 3],
      tracks_included: null,
      price_hellers: 500000,
      sale_start: null,
      sale_end: null,
      quantity: 100,
      quantity_sold: 1,
      pass_status: 'active',
      pass_created_at: '2026-04-07T00:00:00Z',
      pass_description: null,
    };
    const checkDb = makeServiceDb([[checkRow]]);
    const access = await checkPassAccess('token-uuid-1234', checkDb as unknown as PassDB);
    expect(access.activation.accessToken).toBe('token-uuid-1234');
    expect(access.pass.daysIncluded).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 40. API route: POST /conferences/[id]/sessions
// ---------------------------------------------------------------------------

describe('API route: POST /conferences/[id]/sessions', () => {
  it('40. returns 201 on valid session input', async () => {
    const db = makeServiceDb([[SESSION_ROW]]);

    const body = {
      dayId: 'day-1',
      title: 'Opening Keynote',
      sessionType: 'keynote',
      startsAt: '2026-10-01T09:00:00Z',
      endsAt: '2026-10-01T10:00:00Z',
    };

    const request = new NextRequest('http://localhost/api/conferences/conf-1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await createSessionRoute(request, {
      params: { conferenceId: 'conf-1' },
      db: db as unknown as SessionDB,
    });

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.id).toBe('session-1');
    expect(json.sessionType).toBe('keynote');
  });

  it('41. returns 422 on invalid dates (ends_at before starts_at)', async () => {
    const db = makeServiceDb([]);

    const body = {
      dayId: 'day-1',
      title: 'Bad Session',
      sessionType: 'talk',
      startsAt: '2026-10-01T10:00:00Z',
      endsAt: '2026-10-01T08:00:00Z', // invalid!
    };

    const request = new NextRequest('http://localhost/api/conferences/conf-1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await createSessionRoute(request, {
      params: { conferenceId: 'conf-1' },
      db: db as unknown as SessionDB,
    });

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.error).toBeDefined();
  });
});
