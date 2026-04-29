import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleIntent, getSession, saveSession } from '../services/intent.handler';
import {
  VoiceAuthRequiredError,
  VoiceCartEmptyError,
} from '../lib/types';
import type { VoiceRequest, VoiceSession } from '../lib/types';

// ─── Mocks ───────────────────────────────────────────────────

const mockDb = {
  query: vi.fn(),
  queryOne: vi.fn(),
};

const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
};

const deps = { db: mockDb, cache: mockCache };

beforeEach(() => {
  vi.resetAllMocks();
  mockCache.get.mockResolvedValue(null); // no existing session
  mockCache.set.mockResolvedValue(undefined);
});

// ─── Fixtures ────────────────────────────────────────────────

function makeRequest(intent: VoiceRequest['intent'], extra: Partial<VoiceRequest> = {}): VoiceRequest {
  return {
    platform: 'alexa',
    sessionId: 'session-1',
    userId: 'user-1',
    intent,
    slots: {},
    locale: 'cs-CZ',
    isNewSession: false,
    ...extra,
  };
}

const eventRow = {
  id: 'event-1',
  name: 'Rock Festival 2026',
  date_start: '2026-07-15T18:00:00Z',
  venue: 'O2 Arena',
  city: 'Praha',
  lowest_price_halire: 89900,
  available_tickets: 250,
};

// ─── LaunchRequest ────────────────────────────────────────────

describe('LaunchRequest', () => {
  it('returns welcome message and does not end session', async () => {
    const response = await handleIntent(deps, makeRequest('LaunchRequest'));

    expect(response.speech).toContain('Vítejte');
    expect(response.endSession).toBe(false);
  });
});

// ─── SearchEvents ─────────────────────────────────────────────

describe('SearchEvents', () => {
  it('returns top event when results found', async () => {
    mockDb.query.mockResolvedValueOnce([eventRow]);

    const response = await handleIntent(deps, makeRequest('SearchEvents', {
      slots: { city: { name: 'city', value: 'Praha' } },
    }));

    expect(response.speech).toContain('Rock Festival');
    expect(response.endSession).toBe(false);
    expect(response.card?.title).toBe('Rock Festival 2026');
  });

  it('returns not-found message when no events', async () => {
    mockDb.query.mockResolvedValueOnce([]);

    const response = await handleIntent(deps, makeRequest('SearchEvents', {
      slots: { city: { name: 'city', value: 'Brno' } },
    }));

    expect(response.speech).toContain('Nenašel jsem');
  });
});

// ─── GetEventDetails ──────────────────────────────────────────

describe('GetEventDetails', () => {
  it('returns event details with price and availability', async () => {
    mockDb.queryOne.mockResolvedValueOnce(eventRow);

    const response = await handleIntent(deps, makeRequest('GetEventDetails', {
      slots: { eventId: { name: 'eventId', value: 'event-1' } },
    }));

    expect(response.speech).toContain('O2 Arena');
    expect(response.speech).toContain('899');
    expect(response.endSession).toBe(false);
  });

  it('says not found when event missing', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    const response = await handleIntent(deps, makeRequest('GetEventDetails', {
      slots: { eventId: { name: 'eventId', value: 'missing' } },
    }));

    expect(response.speech).toContain('nenašel');
  });
});

// ─── AddToCart ────────────────────────────────────────────────

describe('AddToCart', () => {
  it('stores event in session cart', async () => {
    mockDb.queryOne.mockResolvedValueOnce(eventRow);

    const response = await handleIntent(deps, makeRequest('AddToCart', {
      slots: {
        eventId: { name: 'eventId', value: 'event-1' },
        quantity: { name: 'quantity', value: '2' },
      },
    }));

    expect(response.speech).toContain('Rock Festival');
    expect(response.speech).toContain('2');
    expect(response.endSession).toBe(false);

    // Session should have been saved with cart
    const savedSession = mockCache.set.mock.calls[0][1] as VoiceSession;
    expect(savedSession.pendingCart?.eventId).toBe('event-1');
    expect(savedSession.pendingCart?.quantity).toBe(2);
  });

  it('throws VoiceAuthRequiredError when not logged in', async () => {
    const request = makeRequest('AddToCart', {
      userId: undefined,
      slots: { eventId: { name: 'eventId', value: 'event-1' } },
    });

    await expect(handleIntent(deps, request)).rejects.toThrow(VoiceAuthRequiredError);
  });
});

// ─── Checkout ────────────────────────────────────────────────

describe('Checkout', () => {
  const sessionWithCart: VoiceSession = {
    sessionId: 'session-1',
    userId: 'user-1',
    platform: 'alexa',
    pendingCart: { eventId: 'event-1', eventName: 'Rock Festival', quantity: 2, priceHalire: 179800 },
    lastUpdated: new Date(),
  };

  it('creates order and confirms purchase', async () => {
    mockCache.get.mockResolvedValueOnce(sessionWithCart);
    mockDb.queryOne.mockResolvedValueOnce({ id: 'order-abc-123' }); // createVoiceOrder

    const response = await handleIntent(deps, makeRequest('Checkout'));

    expect(response.speech).toContain('Rock Festival');
    expect(response.speech).toContain('order-abc-123');
    expect(response.endSession).toBe(true);
    expect(response.card?.title).toContain('potvrzena');
  });

  it('throws VoiceCartEmptyError when no cart', async () => {
    await expect(handleIntent(deps, makeRequest('Checkout'))).rejects.toThrow(VoiceCartEmptyError);
  });
});

// ─── CheckOrderStatus ─────────────────────────────────────────

describe('CheckOrderStatus', () => {
  it('returns status of latest order', async () => {
    mockDb.query.mockResolvedValueOnce([{
      order_id: 'order-1',
      status: 'completed',
      event_name: 'Rock Festival',
      ticket_count: '2',
      total_halire: 179800,
    }]);

    const response = await handleIntent(deps, makeRequest('CheckOrderStatus'));

    expect(response.speech).toContain('Rock Festival');
    expect(response.speech).toContain('zaplaceno');
  });

  it('says no orders when empty', async () => {
    mockDb.query.mockResolvedValueOnce([]);

    const response = await handleIntent(deps, makeRequest('CheckOrderStatus'));
    expect(response.speech).toContain('žádné objednávky');
  });
});

// ─── ListMyTickets ────────────────────────────────────────────

describe('ListMyTickets', () => {
  it('lists upcoming tickets', async () => {
    mockDb.query.mockResolvedValueOnce([
      { order_id: 'o-1', status: 'completed', event_name: 'Jazz Night', ticket_count: '1', total_halire: 50000 },
      { order_id: 'o-2', status: 'completed', event_name: 'Rock Fest', ticket_count: '2', total_halire: 179800 },
    ]);

    const response = await handleIntent(deps, makeRequest('ListMyTickets'));

    expect(response.speech).toContain('Jazz Night');
    expect(response.speech).toContain('Rock Fest');
  });
});

// ─── CancelOrder ─────────────────────────────────────────────

describe('CancelOrder', () => {
  it('clears pending cart when cart exists', async () => {
    const sessionWithCart: VoiceSession = {
      sessionId: 'session-1',
      userId: 'user-1',
      platform: 'alexa',
      pendingCart: { eventId: 'event-1', eventName: 'Rock Festival', quantity: 1, priceHalire: 89900 },
      lastUpdated: new Date(),
    };
    mockCache.get.mockResolvedValueOnce(sessionWithCart);

    const response = await handleIntent(deps, makeRequest('CancelOrder'));

    expect(response.speech).toContain('vyprázdněn');
    const savedSession = mockCache.set.mock.calls[0][1] as VoiceSession;
    expect(savedSession.pendingCart).toBeUndefined();
  });

  it('informs user when no active cart', async () => {
    const response = await handleIntent(deps, makeRequest('CancelOrder'));
    expect(response.speech).toContain('Nemáte žádný aktivní košík');
  });
});

// ─── Help and Stop ────────────────────────────────────────────

describe('Help / Stop', () => {
  it('AMAZON.HelpIntent returns usage instructions', async () => {
    const response = await handleIntent(deps, makeRequest('AMAZON.HelpIntent'));
    expect(response.speech).toContain('vstupenky');
    expect(response.endSession).toBe(false);
  });

  it('AMAZON.StopIntent ends session', async () => {
    const response = await handleIntent(deps, makeRequest('AMAZON.StopIntent'));
    expect(response.endSession).toBe(true);
  });
});

// ─── Auth guard ───────────────────────────────────────────────

describe('Auth guard', () => {
  it('CheckOrderStatus requires auth', async () => {
    const request = makeRequest('CheckOrderStatus', { userId: undefined });
    await expect(handleIntent(deps, request)).rejects.toThrow(VoiceAuthRequiredError);
  });

  it('Checkout requires auth', async () => {
    const request = makeRequest('Checkout', { userId: undefined });
    await expect(handleIntent(deps, request)).rejects.toThrow(VoiceAuthRequiredError);
  });
});

// ─── Session helpers ──────────────────────────────────────────

describe('getSession / saveSession', () => {
  it('returns null when no session in cache', async () => {
    mockCache.get.mockResolvedValueOnce(null);
    const session = await getSession(deps, 'session-1');
    expect(session).toBeNull();
  });

  it('saves session to cache with TTL', async () => {
    const session: VoiceSession = {
      sessionId: 'session-1',
      platform: 'google_assistant',
      lastUpdated: new Date(),
    };
    await saveSession(deps, session);
    expect(mockCache.set).toHaveBeenCalledWith('voice:session:session-1', session, 300);
  });
});
