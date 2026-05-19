import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock web-push lib přes module factory
vi.mock('./web-push', () => ({
  sendPushToUser: vi.fn(async () => ({ sent: 1, failed: 0, mock: 0 })),
}));

// Mock pg.Pool
const mockQuery = vi.fn();
vi.mock('pg', () => ({
  Pool: vi.fn(() => ({ query: mockQuery })),
}));

import { notifyFollowers } from './notify-followers';
import { sendPushToUser } from './web-push';

describe('notifyFollowers', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    (sendPushToUser as ReturnType<typeof vi.fn>).mockClear();
  });

  it('vrátí 0 followers pokud nikdo nesleduje', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await notifyFollowers({
      promoterId: 'p-1',
      eventId: 'e-1',
      eventTitle: 'Test',
    });
    expect(r.followers).toBe(0);
    expect(r.sent).toBe(0);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it('pošle push každému followerovi', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u-1', promoter_name: 'Test Promoter' },
        { user_id: 'u-2', promoter_name: 'Test Promoter' },
        { user_id: 'u-3', promoter_name: 'Test Promoter' },
      ],
    });
    const r = await notifyFollowers({
      promoterId: 'p-1',
      eventId: 'e-42',
      eventTitle: 'Nová akce X',
    });
    expect(r.followers).toBe(3);
    expect(r.sent).toBe(3);
    expect(sendPushToUser).toHaveBeenCalledTimes(3);
    expect(sendPushToUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({
        title: 'Test Promoter: nová akce',
        body: 'Nová akce X',
        url: '/cs/events/e-42',
        tag: 'event-e-42',
      }),
    );
  });

  it('agreguje sent/failed/mock napříč followery', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { user_id: 'u-1', promoter_name: 'P' },
        { user_id: 'u-2', promoter_name: 'P' },
      ],
    });
    (sendPushToUser as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ sent: 2, failed: 1, mock: 0 })
      .mockResolvedValueOnce({ sent: 0, failed: 0, mock: 3 });
    const r = await notifyFollowers({
      promoterId: 'p-1',
      eventId: 'e-1',
      eventTitle: 'X',
    });
    expect(r.sent).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.mock).toBe(3);
  });
});
