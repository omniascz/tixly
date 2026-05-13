import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QrDisplayService, injectQrFetcher } from '../services/qr-display.service';
import type { QrState } from '../services/qr-display.service';

// Helper to create a QR response that expires in N milliseconds from now
function makeQrResponse(expiresInMs: number) {
  return {
    qrData: `qr-data-${Date.now()}`,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Clean up any leftover subscriptions
  const entry = QrDisplayService._getEntry('ticket-1');
  if (entry) QrDisplayService.unsubscribe('ticket-1');
});

afterEach(() => {
  QrDisplayService.unsubscribe('ticket-1');
  QrDisplayService.unsubscribe('ticket-2');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('QrDisplayService.subscribe', () => {
  it('registers callback and immediately fetches QR', async () => {
    const mockResponse = makeQrResponse(30_000);
    const fetcher = vi.fn().mockResolvedValue(mockResponse);
    injectQrFetcher(fetcher);

    const callback = vi.fn();
    QrDisplayService.subscribe('ticket-1', callback);

    // Flush the pending async fetch (0ms advances microtasks)
    await vi.advanceTimersByTimeAsync(0);

    expect(fetcher).toHaveBeenCalledWith('ticket-1');
    expect(callback).toHaveBeenCalledOnce();
    const state: QrState = callback.mock.calls[0][0];
    expect(state.qrData).toBe(mockResponse.qrData);
    expect(state.isOffline).toBe(false);
  });

  it('returns ticketId as subscription key', () => {
    injectQrFetcher(vi.fn().mockResolvedValue(makeQrResponse(30_000)));
    const key = QrDisplayService.subscribe('ticket-1', vi.fn());
    expect(key).toBe('ticket-1');
  });

  it('replaces callback if subscribing again for same ticketId', async () => {
    const mockResponse = makeQrResponse(30_000);
    injectQrFetcher(vi.fn().mockResolvedValue(mockResponse));

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    QrDisplayService.subscribe('ticket-1', callback1);
    // Flush initial fetch
    await vi.advanceTimersByTimeAsync(0);

    // Re-subscribe with different callback
    QrDisplayService.subscribe('ticket-1', callback2);
    // callback2 should receive the cached state immediately (synchronous)
    expect(callback2).toHaveBeenCalledOnce();
  });
});

describe('QrDisplayService — refresh before expiry', () => {
  it('schedules refresh 3 seconds before expiry', async () => {
    // QR expires in 30 seconds → refresh timer fires at 27s (30s - 3s lead)
    // Second response has a long expiry so its timer doesn't fire during this test
    const firstResponse = makeQrResponse(30_000);
    const secondResponse = { qrData: 'second-qr-data', expiresAt: new Date(Date.now() + 600_000).toISOString() };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse);
    injectQrFetcher(fetcher);

    const callback = vi.fn();
    QrDisplayService.subscribe('ticket-1', callback);

    // Flush first fetch (fires immediately, no timer)
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance to exactly 27s — the refresh timer for firstResponse fires
    await vi.advanceTimersByTimeAsync(27_000);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenCalledTimes(2);
    const secondState: QrState = callback.mock.calls[1][0];
    expect(secondState.qrData).toBe(secondResponse.qrData);
  });
});

describe('QrDisplayService.unsubscribe', () => {
  it('stops further fetches after unsubscribe', async () => {
    // Use a long expiry so no auto-refresh timer fires during the test
    const fetcher = vi.fn().mockResolvedValue(makeQrResponse(600_000));
    injectQrFetcher(fetcher);

    QrDisplayService.subscribe('ticket-1', vi.fn());
    await vi.advanceTimersByTimeAsync(0);

    QrDisplayService.unsubscribe('ticket-1');
    const callCountAfterUnsub = fetcher.mock.calls.length;

    // Advance timers — no more fetches should happen
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetcher.mock.calls.length).toBe(callCountAfterUnsub);
    expect(QrDisplayService._subscriptionCount()).toBe(0);
  });

  it('removes the entry from subscriptions map', () => {
    injectQrFetcher(vi.fn().mockResolvedValue(makeQrResponse(30_000)));
    QrDisplayService.subscribe('ticket-1', vi.fn());
    QrDisplayService.unsubscribe('ticket-1');
    expect(QrDisplayService._getEntry('ticket-1')).toBeUndefined();
  });
});

describe('QrDisplayService — offline fallback', () => {
  it('delivers cached QR with isOffline=true when fetch fails', async () => {
    const mockResponse = makeQrResponse(30_000);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(mockResponse)      // first fetch succeeds
      .mockRejectedValue(new Error('Network error')); // subsequent fail
    injectQrFetcher(fetcher);

    const callback = vi.fn();
    QrDisplayService.subscribe('ticket-1', callback);

    // Flush first fetch
    await vi.advanceTimersByTimeAsync(0);
    // First call delivers valid state
    expect(callback.mock.calls[0][0].isOffline).toBe(false);

    // Trigger next refresh at 27s (30s expiry - 3s lead)
    await vi.advanceTimersByTimeAsync(27_000);

    // Second call should be offline fallback
    const lastCall = callback.mock.calls[callback.mock.calls.length - 1][0] as QrState;
    expect(lastCall.isOffline).toBe(true);
    expect(lastCall.qrData).toBe(mockResponse.qrData); // still has last valid data
  });

  it('does not call callback if there is no cached data and fetch fails', async () => {
    injectQrFetcher(vi.fn().mockRejectedValue(new Error('offline')));

    const callback = vi.fn();
    QrDisplayService.subscribe('ticket-1', callback);
    await vi.advanceTimersByTimeAsync(0);

    expect(callback).not.toHaveBeenCalled();
  });
});
