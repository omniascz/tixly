import { create } from 'zustand';
import type { Ticket } from '../types/api.types';
import { SECURE_STORE_KEYS } from '../lib/constants';

async function secureGet(key: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store');
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  } catch {
    // ignore in test/non-RN environments
  }
}

export interface TicketsState {
  tickets: Ticket[];
  isLoading: boolean;
  lastSyncAt: number | null;

  // Actions
  fetchTickets: () => Promise<void>;
  refreshTicket: (id: string) => Promise<void>;
  addTicket: (ticket: Ticket) => void;
  removeTicket: (id: string) => void;
  loadFromStorage: () => Promise<void>;
  _setTickets: (tickets: Ticket[]) => Promise<void>;
}

// Lazy import to avoid bundling RN API modules in test environment
async function fetchFromApi(): Promise<Ticket[]> {
  const { ticketsApi } = await import('../api/tickets.api');
  return ticketsApi.listMine();
}

async function fetchOneFromApi(id: string): Promise<Ticket> {
  const { ticketsApi } = await import('../api/tickets.api');
  return ticketsApi.getById(id);
}

export const useTicketsStore = create<TicketsState>((set, get) => ({
  tickets: [],
  isLoading: false,
  lastSyncAt: null,

  fetchTickets: async () => {
    set({ isLoading: true });
    try {
      const tickets = await fetchFromApi();
      await get()._setTickets(tickets);
      set({ lastSyncAt: Date.now() });
    } finally {
      set({ isLoading: false });
    }
  },

  refreshTicket: async (id) => {
    const ticket = await fetchOneFromApi(id);
    const tickets = get().tickets.map((t) => (t.id === id ? ticket : t));
    await get()._setTickets(tickets);
  },

  addTicket: (ticket) => {
    const tickets = [...get().tickets, ticket];
    void get()._setTickets(tickets);
  },

  removeTicket: (id) => {
    const tickets = get().tickets.filter((t) => t.id !== id);
    void get()._setTickets(tickets);
  },

  _setTickets: async (tickets) => {
    set({ tickets });
    await secureSet(SECURE_STORE_KEYS.TICKETS_CACHE, JSON.stringify(tickets));
  },

  loadFromStorage: async () => {
    try {
      const raw = await secureGet(SECURE_STORE_KEYS.TICKETS_CACHE);
      if (raw) {
        const tickets: Ticket[] = JSON.parse(raw);
        set({ tickets });
      }
    } catch {
      // corrupted cache — ignore
    }
  },
}));
