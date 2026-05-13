import type { QrResponse } from '../types/api.types';
import { QR_REFRESH_LEAD_TIME_MS } from '../lib/constants';

export interface QrState {
  qrData: string;
  expiresAt: string;
  isOffline: boolean;
}

type QrCallback = (state: QrState) => void;

interface SubscriptionEntry {
  ticketId: string;
  callback: QrCallback;
  timerId: ReturnType<typeof setTimeout> | null;
  lastKnown: QrState | null;
}

// Injected fetch function — defaults to real API, can be overridden in tests
let _fetchQr: (ticketId: string) => Promise<QrResponse> = async (ticketId) => {
  const { ticketsApi } = await import('../api/tickets.api');
  return ticketsApi.getQr(ticketId);
};

export function injectQrFetcher(fn: (ticketId: string) => Promise<QrResponse>): void {
  _fetchQr = fn;
}

const subscriptions = new Map<string, SubscriptionEntry>();

function scheduleRefresh(entry: SubscriptionEntry): void {
  if (entry.timerId !== null) {
    clearTimeout(entry.timerId);
    entry.timerId = null;
  }

  if (!entry.lastKnown) {
    // No data yet — fetch immediately
    void doRefresh(entry);
    return;
  }

  const expiresAt = new Date(entry.lastKnown.expiresAt).getTime();
  const now = Date.now();
  const delay = expiresAt - now - QR_REFRESH_LEAD_TIME_MS;

  if (delay <= 0) {
    // Already expired or about to — fetch right away
    void doRefresh(entry);
  } else {
    entry.timerId = setTimeout(() => {
      void doRefresh(entry);
    }, delay);
  }
}

async function doRefresh(entry: SubscriptionEntry): Promise<void> {
  // Check if still subscribed
  if (!subscriptions.has(entry.ticketId)) return;

  try {
    const response = await _fetchQr(entry.ticketId);
    const state: QrState = {
      qrData: response.qrData,
      expiresAt: response.expiresAt,
      isOffline: false,
    };
    entry.lastKnown = state;
    entry.callback(state);
    // Schedule next refresh based on new expiry
    scheduleRefresh(entry);
  } catch {
    // Offline fallback
    if (entry.lastKnown) {
      const offlineState: QrState = {
        ...entry.lastKnown,
        isOffline: true,
      };
      entry.callback(offlineState);
    }
    // Retry after lead time
    entry.timerId = setTimeout(() => {
      void doRefresh(entry);
    }, QR_REFRESH_LEAD_TIME_MS);
  }
}

export const QrDisplayService = {
  /**
   * Subscribe to live QR updates for a ticket.
   * Callback is called immediately with the first fetch, then on every refresh.
   * Returns the subscription key (ticketId).
   */
  subscribe(ticketId: string, callback: QrCallback): string {
    // If already subscribed, replace callback
    const existing = subscriptions.get(ticketId);
    if (existing) {
      existing.callback = callback;
      // Deliver cached state immediately if available
      if (existing.lastKnown) {
        callback(existing.lastKnown);
      }
      return ticketId;
    }

    const entry: SubscriptionEntry = {
      ticketId,
      callback,
      timerId: null,
      lastKnown: null,
    };
    subscriptions.set(ticketId, entry);
    scheduleRefresh(entry);
    return ticketId;
  },

  /**
   * Unsubscribe and stop all timers for the given ticketId.
   */
  unsubscribe(ticketId: string): void {
    const entry = subscriptions.get(ticketId);
    if (entry) {
      if (entry.timerId !== null) {
        clearTimeout(entry.timerId);
        entry.timerId = null;
      }
      subscriptions.delete(ticketId);
    }
  },

  /** For testing: get current subscription count */
  _subscriptionCount(): number {
    return subscriptions.size;
  },

  /** For testing: get entry */
  _getEntry(ticketId: string): SubscriptionEntry | undefined {
    return subscriptions.get(ticketId);
  },
};
