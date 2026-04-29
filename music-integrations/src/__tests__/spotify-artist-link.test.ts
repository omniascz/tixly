import { describe, it, expect, vi } from 'vitest';
import {
  createArtistLink,
  getArtistLink,
  pauseArtistLink,
  listArtistLinks,
} from '../services/spotify-artist-link.service.js';
import type { DbAdapter } from '../services/spotify-artist-link.service.js';

const EVENT_ID = 'event-001';
const ARTIST_SPOTIFY_ID = 'spotify:artist:123abc';
const ARTIST_NAME = 'The Rolling Stones';
const LINK_ID = 'link-001';

function makeLinkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    event_id: EVENT_ID,
    artist_spotify_id: ARTIST_SPOTIFY_ID,
    artist_name: ARTIST_NAME,
    ticket_url: 'https://tickets.example.com/event-001',
    status: 'active',
    linked_at: '2026-04-14T10:00:00Z',
    expires_at: null,
    created_at: '2026-04-14T10:00:00Z',
    ...overrides,
  };
}

function makeDb(queryResults: unknown[][] = []): DbAdapter {
  let callIdx = 0;
  return {
    query: vi.fn(async () => {
      const result = queryResults[callIdx] ?? [];
      callIdx++;
      return result;
    }),
    execute: vi.fn(),
    transaction: vi.fn(async (fn) => fn({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn(),
      transaction: vi.fn(),
    } as DbAdapter)),
  };
}

describe('createArtistLink', () => {
  it('vytvoří link s artist a ticket URL', async () => {
    const db = makeDb([[makeLinkRow()]]);

    const result = await createArtistLink(EVENT_ID, {
      artistSpotifyId: ARTIST_SPOTIFY_ID,
      artistName: ARTIST_NAME,
      ticketUrl: 'https://tickets.example.com/event-001',
    }, db);

    expect(result.artistSpotifyId).toBe(ARTIST_SPOTIFY_ID);
    expect(result.ticketUrl).toContain('event-001');
    expect(result.status).toBe('active');
  });

  it('přijme expiresAt pro automatické vypršení po datu akce', async () => {
    const db = makeDb([[makeLinkRow({ expires_at: '2026-04-21T00:00:00Z' })]]);

    const result = await createArtistLink(EVENT_ID, {
      artistSpotifyId: ARTIST_SPOTIFY_ID,
      artistName: ARTIST_NAME,
      ticketUrl: 'https://tickets.example.com/event-001',
      expiresAt: '2026-04-21T00:00:00Z',
    }, db);

    expect(result.expiresAt).toBe('2026-04-21T00:00:00Z');
  });

  it('vyhodí VALIDATION_ERROR bez artistSpotifyId nebo ticketUrl', async () => {
    const db = makeDb([]);

    await expect(
      createArtistLink(EVENT_ID, {
        artistSpotifyId: '',
        artistName: 'Test',
        ticketUrl: 'https://...',
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('getArtistLink', () => {
  it('vrátí link pro aktivního umělce u dané akce', async () => {
    const db = makeDb([[makeLinkRow({ status: 'active' })]]);

    const result = await getArtistLink(EVENT_ID, ARTIST_SPOTIFY_ID, db);

    expect(result).not.toBeNull();
    expect(result?.artistName).toBe(ARTIST_NAME);
  });

  it('vrátí null pokud artist není active', async () => {
    const db = makeDb([[]]);

    const result = await getArtistLink(EVENT_ID, ARTIST_SPOTIFY_ID, db);

    expect(result).toBeNull();
  });
});

describe('pauseArtistLink', () => {
  it('změní status na paused', async () => {
    const db = makeDb([[makeLinkRow({ status: 'paused' })]]);

    const result = await pauseArtistLink(LINK_ID, db);

    expect(result.status).toBe('paused');
  });

  it('vyhodí NOT_FOUND pokud link není active', async () => {
    const db = makeDb([[]]);

    await expect(pauseArtistLink(LINK_ID, db)).rejects.toThrow('NOT_FOUND');
  });
});

describe('listArtistLinks', () => {
  it('vrátí aktivní linky pro event, ignoruje vypršené', async () => {
    const db = makeDb([[
      makeLinkRow({ artist_spotify_id: 'artist-1', status: 'active', expires_at: null }),
      makeLinkRow({ id: 'link-2', artist_spotify_id: 'artist-2', status: 'active', expires_at: '2026-04-25T00:00:00Z' }),
    ]]);

    const result = await listArtistLinks(EVENT_ID, db);

    expect(result).toHaveLength(2);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('expires_at > NOW()');
  });
});
