import { describe, it, expect, vi } from 'vitest';
import {
  getPublicProfile,
  updatePromoterProfile,
  getPromoterEvents,
  followPromoter,
  unfollowPromoter,
  isFollowing,
  getUserFollowedPromoters,
} from '../services/promoter-profile.service.js';
import type { DbAdapter } from '../services/promoter-profile.service.js';

function makeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promoter-001',
    name: 'Rock Legends s.r.o.',
    slug: 'rock-legends',
    logo_url: 'https://cdn.example.com/rock-legends.png',
    cover_image_url: null,
    bio: 'Organizujeme rockové festivaly od roku 2010.',
    website: 'https://rocklegends.cz',
    facebook_url: 'https://facebook.com/rocklegends',
    instagram_url: null,
    twitter_url: null,
    youtube_url: null,
    is_profile_public: true,
    follower_count: '1234',
    ...overrides,
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-001',
    name: 'Rock For People 2026',
    starts_at: '2026-06-25T14:00:00Z',
    ends_at: '2026-06-28T23:00:00Z',
    venue_name: 'Festivalové areál',
    city: 'Hradec Králové',
    thumbnail_url: null,
    is_sold_out: false,
    min_price_hellers: '299000',
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
  };
}

describe('getPublicProfile', () => {
  it('vrátí veřejný profil promotéra', async () => {
    const db = makeDb([[makeProfileRow()]]);
    const result = await getPublicProfile('promoter-001', db);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('Rock Legends s.r.o.');
    expect(result!.followerCount).toBe(1234);
    expect(result!.bio).toBe('Organizujeme rockové festivaly od roku 2010.');
  });

  it('vyhledá podle slugu', async () => {
    const db = makeDb([[makeProfileRow()]]);
    const result = await getPublicProfile('rock-legends', db);
    expect(result!.slug).toBe('rock-legends');
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('p.slug = $1');
  });

  it('vrátí null pro neveřejný profil', async () => {
    const db = makeDb([[]]); // not found (is_profile_public = false filtered by SQL)
    const result = await getPublicProfile('private-promoter', db);
    expect(result).toBeNull();
  });
});

describe('updatePromoterProfile', () => {
  it('aktualizuje bio a sociální sítě', async () => {
    const db = makeDb([], vi.fn());
    await updatePromoterProfile('promoter-001', {
      bio: 'Nové bio',
      facebookUrl: 'https://facebook.com/newpage',
    }, db);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('odmítne URL bez https://', async () => {
    const db = makeDb();
    await expect(updatePromoterProfile('promoter-001', {
      facebookUrl: 'http://facebook.com/page',
    }, db)).rejects.toThrow('facebookUrl must start with https://');
  });

  it('odmítne coverImageUrl bez https://', async () => {
    const db = makeDb();
    await expect(updatePromoterProfile('promoter-001', {
      coverImageUrl: 'ftp://example.com/image.jpg',
    }, db)).rejects.toThrow('coverImageUrl must start with https://');
  });

  it('povolí null hodnoty (reset polí)', async () => {
    const db = makeDb([], vi.fn());
    await updatePromoterProfile('promoter-001', {
      bio: null,
      coverImageUrl: null,
    }, db);
    expect(db.execute).toHaveBeenCalledOnce();
  });
});

describe('getPromoterEvents', () => {
  it('vrátí nadcházející akce promotéra', async () => {
    const db = makeDb([[makeEventRow(), makeEventRow({ id: 'event-002', name: 'Letní fest' })]]);
    const result = await getPromoterEvents('rock-legends', 'upcoming', db);
    expect(result).toHaveLength(2);
    expect(result[0].minPriceHellers).toBe(299000);
  });

  it('vrátí proběhlé akce', async () => {
    const db = makeDb([[makeEventRow({ name: 'Rock 2025' })]]);
    const result = await getPromoterEvents('promoter-001', 'past', db);
    expect(result).toHaveLength(1);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain("e.starts_at < NOW()");
  });

  it('vrátí všechny akce bez filtru', async () => {
    const db = makeDb([[makeEventRow()]]);
    const result = await getPromoterEvents('promoter-001', 'all', db);
    const sql = (db.query as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).not.toContain('AND e.starts_at');
    expect(result).toHaveLength(1);
  });

  it('mapuje null minPriceHellers správně', async () => {
    const db = makeDb([[makeEventRow({ min_price_hellers: null })]]);
    const result = await getPromoterEvents('promoter-001', 'upcoming', db);
    expect(result[0].minPriceHellers).toBeNull();
  });
});

describe('followPromoter', () => {
  it('přidá uživatele jako sledujícího', async () => {
    const db = makeDb([], vi.fn());
    await followPromoter('promoter-001', 'user-001', true, db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });
});

describe('unfollowPromoter', () => {
  it('odstraní sledování', async () => {
    const db = makeDb([], vi.fn());
    await unfollowPromoter('promoter-001', 'user-001', db);
    expect(db.execute).toHaveBeenCalledOnce();
    const sql = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(sql).toContain('DELETE FROM');
  });
});

describe('isFollowing', () => {
  it('vrátí true pokud uživatel sleduje promotéra', async () => {
    const db = makeDb([[{ found: true }]]);
    const result = await isFollowing('promoter-001', 'user-001', db);
    expect(result).toBe(true);
  });

  it('vrátí false pokud uživatel nesleduje', async () => {
    const db = makeDb([[{ found: false }]]);
    const result = await isFollowing('promoter-001', 'user-002', db);
    expect(result).toBe(false);
  });
});

describe('getUserFollowedPromoters', () => {
  it('vrátí seznam sledovaných promotérů', async () => {
    const db = makeDb([[
      { id: 'promoter-001', name: 'Rock Legends', slug: 'rock-legends', logo_url: null },
      { id: 'promoter-002', name: 'Jazz Club Praha', slug: 'jazz-club', logo_url: 'https://cdn.example.com/jazz.png' },
    ]]);

    const result = await getUserFollowedPromoters('user-001', db);
    expect(result).toHaveLength(2);
    expect(result[0].promoterId).toBe('promoter-001');
    expect(result[1].logoUrl).toBe('https://cdn.example.com/jazz.png');
  });
});
