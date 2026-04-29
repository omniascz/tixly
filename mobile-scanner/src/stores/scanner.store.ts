// ---------------------------------------------------------------------------
// Scanner Zustand store
// ---------------------------------------------------------------------------
import { create } from "zustand";
import type { ScanRecord } from "../types/scanner.types";
import { MAX_SCAN_HISTORY } from "../lib/constants";

interface ScannerState {
  selectedEventId: string | null;
  scanHistory: ScanRecord[];
  syncStatus: "idle" | "syncing" | "error" | "offline";
  lastSyncAt: string | null;
  cachedTicketCount: number;

  // Actions
  selectEvent: (eventId: string) => void;
  addScanRecord: (record: ScanRecord) => void;
  setSyncStatus: (status: ScannerState["syncStatus"]) => void;
  updateCacheStats: (count: number, syncedAt: string) => void;
  clearHistory: () => void;
}

export const useScannerStore = create<ScannerState>((set) => ({
  selectedEventId: null,
  scanHistory: [],
  syncStatus: "idle",
  lastSyncAt: null,
  cachedTicketCount: 0,

  selectEvent: (eventId) => set({ selectedEventId: eventId }),

  addScanRecord: (record) =>
    set((state) => ({
      scanHistory: [record, ...state.scanHistory].slice(0, MAX_SCAN_HISTORY),
    })),

  setSyncStatus: (status) => set({ syncStatus: status }),

  updateCacheStats: (count, syncedAt) =>
    set({ cachedTicketCount: count, lastSyncAt: syncedAt }),

  clearHistory: () => set({ scanHistory: [] }),
}));
