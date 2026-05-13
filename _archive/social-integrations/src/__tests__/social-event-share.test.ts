import { describe, it, expect, vi } from 'vitest';
import {
  createSocialShare,
  publishToSocial,
  listSocialShares,
} from '../services/social-event-share.service.js';
import type { DbAdapter, SocialAdapter } from '../services/social-event-share.service.js';

const EVENT_ID = 'event-001';
const PROMOTER_ID = 'promoter-001';
const SHARE_ID = 'share-001';

function makeShareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    event_id: EVENT_ID,
    promoter_id: PROMOTER_ID,
    platform: 'facebook',
    external_event_id: null,
    status: 'draft',
    error_message: null,
    published_at: null,
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

function makeAdapter(overrides: Partial<SocialAdapter> = {}): SocialAdapter {
  return {
    publishEvent: vi.fn().mockResolvedValue({ externalEventId: 'fb-event-123' }),
    getTicketLinkUrl: vi.fn().mockResolvedValue('https://...'),
    ...overrides,
  };
}

describe('createSocialShare', () => {
  it('vytvoří share v draft statusu', async () => {
    const db = makeDb([[makeShareRow({ platform: 'facebook' })]]);

    const result = await createSocialShare(EVENT_ID, PROMOTER_ID, { platform: 'facebook' }, db);

    expect(result.status).toBe('draft');
    expect(result.platform).toBe('facebook');
    expect(result.externalEventId).toBeNull();
  });

  it('podporuje TikTok platform', async () => {
    const db = makeDb([[makeShareRow({ platform: 'tiktok' })]]);

    const result = await createSocialShare(EVENT_ID, PROMOTER_ID, { platform: 'tiktok' }, db);

    expect(result.platform).toBe('tiktok');
  });
});

describe('publishToSocial', () => {
  it('volá adapter.publishEvent a nastaví status=published + externalEventId', async () => {
    const db = makeDb([
      [makeShareRow()],
      [makeShareRow({ status: 'published', external_event_id: 'fb-event-123', published_at: '2026-04-14T11:00:00Z' })],
    ]);
    const adapter = makeAdapter();

    const result = await publishToSocial(SHARE_ID, PROMOTER_ID, adapter, {
      title: 'Great Concert',
      description: 'Amazing event',
      date: '2026-04-20',
      venueAddress: 'Praha',
      ticketUrl: 'https://tickets.example.com/event-001',
    }, db);

    expect(result.status).toBe('published');
    expect(result.externalEventId).toBe('fb-event-123');
    expect(adapter.publishEvent).toHaveBeenCalledWith(
      EVENT_ID,
      'Great Concert',
      'Amazing event',
      '2026-04-20',
      'Praha',
      expect.stringContaining('event-001'),
    );
  });

  it('loguje error a nastaví status=failed pokud publishEvent selže', async () => {
    const db = makeDb([
      [makeShareRow()],
      [makeShareRow({ status: 'failed', error_message: 'FB API 503' })],
    ]);
    const adapter = makeAdapter({
      publishEvent: vi.fn().mockRejectedValue(new Error('FB API 503')),
    });

    const result = await publishToSocial(SHARE_ID, PROMOTER_ID, adapter, {
      title: 'Event',
      description: 'Desc',
      date: '2026-04-20',
      venueAddress: 'Venue',
      ticketUrl: 'https://...',
    }, db);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('FB API 503');
  });

  it('je tenant-scoped na promoter_id', async () => {
    const db = makeDb([[]]);
    const adapter = makeAdapter();

    await expect(
      publishToSocial(SHARE_ID, 'wrong-promoter', adapter, {
        title: '', description: '', date: '', venueAddress: '', ticketUrl: '',
      }, db),
    ).rejects.toThrow('NOT_FOUND');
  });
});

describe('listSocialShares', () => {
  it('vrátí všechny shares pro event', async () => {
    const db = makeDb([[
      makeShareRow({ platform: 'facebook' }),
      makeShareRow({ id: 'share-2', platform: 'tiktok' }),
    ]]);

    const result = await listSocialShares(EVENT_ID, PROMOTER_ID, db);

    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('facebook');
    expect(result[1].platform).toBe('tiktok');
  });
});
