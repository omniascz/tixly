import { SYNC_INTERVAL_MS } from '../lib/constants';
import type { Ticket } from '../types/api.types';

// Injected dependencies — makes the service fully testable
export interface SyncServiceDeps {
  fetchTickets: () => Promise<Ticket[]>;
  getStoredTickets: () => Ticket[];
  setTickets: (tickets: Ticket[]) => Promise<void>;
  onSyncComplete?: (tickets: Ticket[]) => void;
  onSyncError?: (error: unknown) => void;
}

export class SyncService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private deps: SyncServiceDeps;

  constructor(deps: SyncServiceDeps) {
    this.deps = deps;
  }

  /** Run a single sync cycle. */
  async sync(): Promise<Ticket[]> {
    try {
      const tickets = await this.deps.fetchTickets();
      await this.deps.setTickets(tickets);
      this.deps.onSyncComplete?.(tickets);
      return tickets;
    } catch (error) {
      this.deps.onSyncError?.(error);
      // Return existing cache — do NOT wipe it on network error
      const cached = this.deps.getStoredTickets();
      return cached;
    }
  }

  /** Start background sync every SYNC_INTERVAL_MS. */
  start(): void {
    if (this.intervalId !== null) return;
    // Run immediately, then on interval
    void this.sync();
    this.intervalId = setInterval(() => {
      void this.sync();
    }, SYNC_INTERVAL_MS);
  }

  /** Stop background sync. */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }
}

/**
 * Factory that wires SyncService to the real Zustand store + API.
 * Called from the app's root once auth is confirmed.
 */
export async function createProductionSyncService(): Promise<SyncService> {
  const { useTicketsStore } = await import('../stores/tickets.store');
  const { ticketsApi } = await import('../api/tickets.api');

  const store = useTicketsStore.getState();

  return new SyncService({
    fetchTickets: () => ticketsApi.listMine(),
    getStoredTickets: () => useTicketsStore.getState().tickets,
    setTickets: async (tickets) => {
      await store._setTickets(tickets);
    },
  });
}
