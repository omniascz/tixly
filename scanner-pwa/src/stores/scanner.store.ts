// ---------------------------------------------------------------------------
// Zustand store for the scanner UI state
// ---------------------------------------------------------------------------
import { create } from 'zustand';
import type { ScanRecord } from '../lib/offline-cache.js';

interface ScannerState {
  currentEventId: string | null;
  isOnline: boolean;
  lastSyncAt: number | null;
  pendingScansCount: number;
  recentScans: ScanRecord[];
  setEvent: (eventId: string | null) => void;
  addScan: (scan: ScanRecord) => void;
  setOnline: (online: boolean) => void;
  setLastSync: (ts: number) => void;
  setPendingCount: (n: number) => void;
}

const MAX_RECENT = 50;

export const useScannerStore = create<ScannerState>((set) => ({
  currentEventId: null,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  lastSyncAt: null,
  pendingScansCount: 0,
  recentScans: [],
  setEvent: (eventId) => set({ currentEventId: eventId }),
  addScan: (scan) =>
    set((s) => ({
      recentScans: [scan, ...s.recentScans].slice(0, MAX_RECENT),
    })),
  setOnline: (online) => set({ isOnline: online }),
  setLastSync: (ts) => set({ lastSyncAt: ts }),
  setPendingCount: (n) => set({ pendingScansCount: n }),
}));
