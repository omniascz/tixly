import { describe, it, expect, vi } from 'vitest';
import {
  createNotifications,
  sendNotification,
  markDelivered,
  markOpened,
  getNotificationMetrics,
} from '../services/personalized-push.service.js';
import type { DbAdapter, PushProvider } from '../services/personalized-push.service.js';

const EVENT_ID = 'event-001';
const USER_ID = 'user-001';
const NOTIFICATION_ID = 'notif-001';

function makeNotificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    event_id: EVENT_ID,
    user_id: USER_ID,
    type: 'on_sale',
    title: 'Vstupenky jsou v prodeji!',
    message: 'Koupit teď',
    deep_link: 'https://app.example.com/event/event-001',
    sent: false,
    sent_at: null,
    delivered: false,
    delivered_at: null,
    opened: false,
    opened_at: null,
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

function makeProvider(overrides: Partial<PushProvider> = {}): PushProvider {
  return {
    send: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('createNotifications', () => {
  it('vytvoří batch notifikací pro seznam uživatelů', async () => {
    const db = makeDb([[
      makeNotificationRow({ user_id: 'user-1' }),
      makeNotificationRow({ id: 'notif-2', user_id: 'user-2' }),
    ]]);

    const result = await createNotifications({
      eventId: EVENT_ID,
      userIds: ['user-1', 'user-2'],
      type: 'on_sale',
      title: 'Vstupenky jsou v prodeji!',
      message: 'Koupit teď',
      deepLink: 'https://app.example.com/event/event-001',
    }, db);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('on_sale');
    expect(result[1].userId).toBe('user-2');
  });

  it('vyhodí VALIDATION_ERROR pokud je seznam uživatelů prázdný', async () => {
    const db = makeDb([]);

    await expect(
      createNotifications({
        eventId: EVENT_ID,
        userIds: [],
        type: 'on_sale',
        title: 'Title',
        message: 'Message',
      }, db),
    ).rejects.toThrow('VALIDATION_ERROR');
  });
});

describe('sendNotification', () => {
  it('volá provider.send a markuje notifikaci jako sent', async () => {
    const provider = makeProvider();
    const db = makeDb([
      [makeNotificationRow({ sent: false })],
      [makeNotificationRow({ sent: true, sent_at: '2026-04-14T10:30:00Z' })],
    ]);

    const result = await sendNotification(NOTIFICATION_ID, provider, db);

    expect(result.sent).toBe(true);
    expect(provider.send).toHaveBeenCalledWith({
      userId: USER_ID,
      title: 'Vstupenky jsou v prodeji!',
      message: 'Koupit teď',
      deepLink: expect.stringContaining('event-001'),
    });
  });

  it('vyhodí SEND_FAILED pokud provider selže', async () => {
    const provider = makeProvider({ send: vi.fn().mockResolvedValue(false) });
    const db = makeDb([[makeNotificationRow({ sent: false })]]);

    await expect(
      sendNotification(NOTIFICATION_ID, provider, db),
    ).rejects.toThrow('SEND_FAILED');
  });
});

describe('markDelivered', () => {
  it('nastaví delivered=true a delivered_at=NOW', async () => {
    const db = makeDb([[makeNotificationRow({ delivered: true, delivered_at: '2026-04-14T10:35:00Z' })]]);

    const result = await markDelivered(NOTIFICATION_ID, db);

    expect(result.delivered).toBe(true);
    expect(result.deliveredAt).toBe('2026-04-14T10:35:00Z');
  });
});

describe('markOpened', () => {
  it('nastaví opened=true a opened_at=NOW', async () => {
    const db = makeDb([[makeNotificationRow({ opened: true, opened_at: '2026-04-14T10:40:00Z' })]]);

    const result = await markOpened(NOTIFICATION_ID, db);

    expect(result.opened).toBe(true);
    expect(result.openedAt).toBe('2026-04-14T10:40:00Z');
  });
});

describe('getNotificationMetrics', () => {
  it('vrátí metriky: sent, delivered, opened, rates', async () => {
    const db = makeDb([[{ sent: 1000, delivered: 900, opened: 450 }]]);

    const result = await getNotificationMetrics(EVENT_ID, db);

    expect(result.sent).toBe(1000);
    expect(result.delivered).toBe(900);
    expect(result.opened).toBe(450);
    expect(result.deliveryRate).toBe(90);  // 900 / 1000 * 100
    expect(result.openRate).toBe(50);      // 450 / 900 * 100
  });
});
