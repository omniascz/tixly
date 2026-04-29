import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncService } from '../services/sync.service';
import type { Ticket } from '../types/api.types';

function makeTicket(id: string): Ticket {
  return {
    id,
    orderId: `order-${id}`,
    eventId: 'event-1',
    eventTitle: 'Test Event',
    eventDate: '2026-05-10T17:00:00.000Z',
    venueName: 'Test Venue',
    seatInfo: 'A1',
    holderName: 'Jan Novák',
    status: 'active',
  };
}

let storedTickets: Ticket[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let setTicketsMock: ReturnType<typeof vi.fn>;
let onSyncComplete: ReturnType<typeof vi.fn>;
let onSyncError: ReturnType<typeof vi.fn>;
let service: SyncService;

beforeEach(() => {
  vi.useFakeTimers();
  storedTickets = [];
  fetchMock = vi.fn();
  setTicketsMock = vi.fn().mockImplementation(async (tickets: Ticket[]) => {
    storedTickets = tickets;
  });
  onSyncComplete = vi.fn();
  onSyncError = vi.fn();

  service = new SyncService({
    fetchTickets: fetchMock,
    getStoredTickets: () => storedTickets,
    setTickets: setTicketsMock,
    onSyncComplete,
    onSyncError,
  });
});

afterEach(() => {
  service.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SyncService.sync', () => {
  it('calls fetchTickets and stores the result', async () => {
    const tickets = [makeTicket('t1'), makeTicket('t2')];
    fetchMock.mockResolvedValue(tickets);

    const result = await service.sync();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(setTicketsMock).toHaveBeenCalledWith(tickets);
    expect(result).toEqual(tickets);
  });

  it('calls onSyncComplete with fetched tickets', async () => {
    const tickets = [makeTicket('t1')];
    fetchMock.mockResolvedValue(tickets);

    await service.sync();

    expect(onSyncComplete).toHaveBeenCalledWith(tickets);
  });

  it('calls correct endpoint — fetchTickets is the provided abstraction', async () => {
    fetchMock.mockResolvedValue([]);
    await service.sync();
    expect(fetchMock).toHaveBeenCalledWith(); // no args
  });
});

describe('SyncService.sync — offline behavior', () => {
  it('returns existing cache on network error', async () => {
    const cached = [makeTicket('cached-1')];
    storedTickets = cached;
    fetchMock.mockRejectedValue(new Error('Network error'));

    const result = await service.sync();

    expect(result).toEqual(cached);
  });

  it('does NOT overwrite cache on network error', async () => {
    const cached = [makeTicket('cached-1')];
    storedTickets = cached;
    fetchMock.mockRejectedValue(new Error('Network error'));

    await service.sync();

    expect(setTicketsMock).not.toHaveBeenCalled();
  });

  it('calls onSyncError on network error', async () => {
    const error = new Error('Network error');
    fetchMock.mockRejectedValue(error);

    await service.sync();

    expect(onSyncError).toHaveBeenCalledWith(error);
  });

  it('preserves cache when empty and fetch fails', async () => {
    storedTickets = [];
    fetchMock.mockRejectedValue(new Error('offline'));

    const result = await service.sync();
    expect(result).toEqual([]);
  });
});

describe('SyncService.start / stop', () => {
  it('runs initial sync immediately on start', async () => {
    fetchMock.mockResolvedValue([]);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('is running after start', () => {
    fetchMock.mockResolvedValue([]);
    service.start();
    expect(service.isRunning()).toBe(true);
  });

  it('is not running after stop', () => {
    fetchMock.mockResolvedValue([]);
    service.start();
    service.stop();
    expect(service.isRunning()).toBe(false);
  });

  it('does not start twice if called multiple times', () => {
    fetchMock.mockResolvedValue([]);
    service.start();
    service.start();
    // Should still be one interval running
    expect(service.isRunning()).toBe(true);
  });

  it('syncs again after SYNC_INTERVAL_MS', async () => {
    fetchMock.mockResolvedValue([]);
    service.start();
    await vi.advanceTimersByTimeAsync(0); // flush initial sync promise

    const callsBefore = fetchMock.mock.calls.length;
    // Advance 5 minutes to trigger the interval
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('stops syncing after stop()', async () => {
    fetchMock.mockResolvedValue([]);
    service.start();
    await vi.advanceTimersByTimeAsync(0);

    service.stop();
    const callsAfterStop = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(fetchMock.mock.calls.length).toBe(callsAfterStop);
  });
});
