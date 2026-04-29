import { describe, it, expect, vi } from 'vitest';
import {
  createArtist,
  getLineup,
  getArtist,
  linkArtistProfile,
  getArtistProfiles,
  updateArtist,
  deleteArtist,
} from '../services/artist.service.js';
import type { DbAdapter } from '../services/artist.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const ARTIST_ID = 'artist-001';

function makeArtistRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ARTIST_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    name: 'The Beatles',
    bio: 'British rock band',
    image_url: 'https://cdn.example.com/beatles.jpg',
    stage_order: 1,
    stage_name: 'Main Stage',
    performance_time: '20:00:00',
    performance_date: '2026-05-15',
    genre_tags: ['rock', 'pop'],
    created_at: '2026-04-14T10:00:00Z',
    updated_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = [], executeMock = vi.fn()): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: executeMock,
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: executeMock,
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createArtist', () => {
  it('vytvoří nového umělce v line-upu', async () => {
    const db = makeDb([[makeArtistRow()]]);

    const result = await createArtist(PROMOTER_ID, {
      eventId: EVENT_ID,
      name: 'The Beatles',
      bio: 'British rock band',
      imageUrl: 'https://cdn.example.com/beatles.jpg',
      stageOrder: 1,
      stageName: 'Main Stage',
      performanceTime: '20:00:00',
      performanceDate: '2026-05-15',
      genreTags: ['rock', 'pop'],
    }, db);

    expect(result.name).toBe('The Beatles');
    expect(result.bio).toBe('British rock band');
    expect(result.genreTags).toEqual(['rock', 'pop']);
  });

  it('vyhodí VALIDATION_ERROR bez jména', async () => {
    const db = makeDb([]);

    await expect(
      createArtist(PROMOTER_ID, {
        eventId: EVENT_ID,
        name: '',
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getLineup', () => {
  it('vrátí všechny umělce pro event (seřazené stage_order)', async () => {
    const db = makeDb([[
      makeArtistRow({ id: 'a1', stage_order: 1 }),
      makeArtistRow({ id: 'a2', stage_order: 2 }),
    ]]);

    const result = await getLineup(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].stageOrder).toBe(1);
    expect(result[1].stageOrder).toBe(2);
  });

  it('vrátí prázdný seznam pokud line-up je prázdný', async () => {
    const db = makeDb([[]]);

    const result = await getLineup(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(0);
  });
});

describe('getArtist', () => {
  it('vrátí umělce podle ID (tenant-scoped)', async () => {
    const db = makeDb([[makeArtistRow()]]);

    const result = await getArtist(ARTIST_ID, PROMOTER_ID, db);

    expect(result).not.toBeNull();
    expect(result?.name).toBe('The Beatles');
  });

  it('vrátí null pokud umělec neexistuje', async () => {
    const db = makeDb([[]]);

    const result = await getArtist('nonexistent', PROMOTER_ID, db);

    expect(result).toBeNull();
  });
});

describe('linkArtistProfile', () => {
  it('propojí Spotify profil s umělcem (upsert)', async () => {
    const db = makeDb([[{
      id: 'profile-1',
      artist_id: ARTIST_ID,
      platform: 'spotify',
      profile_id: 'spotify-123',
      profile_url: 'https://open.spotify.com/artist/123',
      follower_count: 50000,
      monthly_listeners: 100000,
      popularity_score: 85,
      synced_at: '2026-04-14T10:30:00Z',
    }]]);

    const result = await linkArtistProfile(
      ARTIST_ID,
      'spotify',
      'spotify-123',
      {
        followerCount: 50000,
        monthlyListeners: 100000,
        popularityScore: 85,
        genres: ['rock', 'pop'],
      },
      db,
    );

    expect(result.platform).toBe('spotify');
    expect(result.followerCount).toBe(50000);
  });
});

describe('getArtistProfiles', () => {
  it('vrátí všechny externí profily umělce', async () => {
    const db = makeDb([[
      {
        id: 'p1',
        artist_id: ARTIST_ID,
        platform: 'spotify',
        profile_id: 'spotify-123',
        profile_url: 'https://open.spotify.com/artist/123',
        follower_count: 50000,
        monthly_listeners: 100000,
        popularity_score: 85,
        synced_at: '2026-04-14T10:30:00Z',
      },
      {
        id: 'p2',
        artist_id: ARTIST_ID,
        platform: 'bandsintown',
        profile_id: 'bandsintown-456',
        profile_url: 'https://www.bandsintown.com/a/123',
        follower_count: 30000,
        monthly_listeners: null,
        popularity_score: 75,
        synced_at: '2026-04-14T10:30:00Z',
      },
    ]]);

    const result = await getArtistProfiles(ARTIST_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('spotify');
    expect(result[1].platform).toBe('bandsintown');
  });
});

describe('updateArtist', () => {
  it('aktualizuje umělce (tenant-scoped)', async () => {
    const db = makeDb([[makeArtistRow({ name: 'The Beatles Updated' })]]);

    const result = await updateArtist(
      ARTIST_ID,
      PROMOTER_ID,
      { name: 'The Beatles Updated' },
      db,
    );

    expect(result.name).toBe('The Beatles Updated');
  });

  it('vyhodí chybu pokud žádné pole není k aktualizaci', async () => {
    const db = makeDb([]);

    await expect(
      updateArtist(ARTIST_ID, PROMOTER_ID, {}, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('deleteArtist', () => {
  it('smaže umělce (tenant-scoped)', async () => {
    const executeMock = vi.fn().mockResolvedValue(undefined);
    const db = makeDb([], executeMock);

    await deleteArtist(ARTIST_ID, PROMOTER_ID, db);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const sql = executeMock.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE');
    expect(sql).toContain('promoter_id = $2');
  });
});
