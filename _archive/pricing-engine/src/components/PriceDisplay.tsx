'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import type { PriceCalculation, PricingPhase } from '../types/pricing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PriceResponse extends PriceCalculation {
  serverTime: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PriceDisplayProps {
  ticketTypeId: string;
  eventId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHASE_LABELS: Record<PricingPhase, string> = {
  early_bird: 'Early Bird',
  regular: 'Regular',
  late: 'Posledních X míst',
  door: 'Na místě',
};

const PHASE_BADGE_CLASSES: Record<PricingPhase, string> = {
  early_bird: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  regular: 'bg-blue-100 text-blue-800 border border-blue-300',
  late: 'bg-amber-100 text-amber-800 border border-amber-300',
  door: 'bg-red-100 text-red-800 border border-red-300',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00';

  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days} ${days === 1 ? 'den' : days < 5 ? 'dny' : 'dní'}`;
  }
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PriceDisplay({ ticketTypeId, eventId }: PriceDisplayProps) {
  const [data, setData] = useState<PriceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [priceChanged, setPriceChanged] = useState(false);

  // Countdown state
  const [now, setNow] = useState<number>(Date.now());
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Clock offset: serverTime - clientTime at last fetch
  const serverOffsetRef = useRef<number>(0);

  const fetchPrice = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/events/${eventId}/ticket-types/${ticketTypeId}/price`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = (await response.json()) as PriceResponse;
      serverOffsetRef.current = json.serverTime - Date.now();

      setData((prev) => {
        if (prev !== null && prev.finalPrice !== json.finalPrice) {
          setPrevPrice(prev.finalPrice);
          setPriceChanged(true);
          setTimeout(() => setPriceChanged(false), 600);
        }
        return json;
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba načítání ceny');
    } finally {
      setIsLoading(false);
    }
  }, [ticketTypeId, eventId]);

  // Initial fetch + polling
  useEffect(() => {
    void fetchPrice();
    const pollTimer = setInterval(() => void fetchPrice(), POLL_INTERVAL_MS);
    return () => clearInterval(pollTimer);
  }, [fetchPrice]);

  // Countdown clock — ticks every second
  useEffect(() => {
    clockRef.current = setInterval(() => {
      setNow(Date.now() + serverOffsetRef.current);
    }, 1_000);
    return () => {
      if (clockRef.current !== null) clearInterval(clockRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl bg-gray-100 p-6 w-full max-w-xs">
        <div className="h-4 bg-gray-300 rounded w-1/3 mb-3" />
        <div className="h-8 bg-gray-300 rounded w-1/2" />
      </div>
    );
  }

  if (error !== null || data === null) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error ?? 'Nepodařilo se načíst cenu.'}
      </div>
    );
  }

  const { currentPhase, finalPrice, nextPhase, nextPhaseAt, remainingQtyHint } =
    data as PriceResponse & { remainingQtyHint?: number };

  // Countdown
  let countdownLabel: string | null = null;
  if (nextPhaseAt?.date !== undefined) {
    const msRemaining = new Date(nextPhaseAt.date).getTime() - now;
    if (msRemaining > 0) {
      countdownLabel = `Tato cena platí ještě: ${formatCountdown(msRemaining)}`;
    }
  } else if (nextPhaseAt?.qty !== undefined) {
    const spotsLeft = nextPhaseAt.qty;
    countdownLabel = `Zbývá ${spotsLeft} míst za tuto cenu`;
  }

  const badgeClass = PHASE_BADGE_CLASSES[currentPhase];
  const phaseLabel =
    currentPhase === 'late' && remainingQtyHint !== undefined
      ? `Posledních ${remainingQtyHint} míst`
      : PHASE_LABELS[currentPhase];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm w-full max-w-xs">
      {/* Phase badge */}
      <div className="mb-3">
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${badgeClass}`}
        >
          {phaseLabel}
        </span>
      </div>

      {/* Price with animation */}
      <div className="relative overflow-hidden">
        {prevPrice !== null && priceChanged && (
          <span
            className="absolute inset-0 flex items-center text-3xl font-bold text-gray-400 transition-all duration-300 opacity-0 translate-y-[-100%]"
            aria-hidden="true"
          >
            {formatCurrency(prevPrice)}
          </span>
        )}
        <span
          className={`block text-3xl font-bold text-gray-900 transition-all duration-300 ${
            priceChanged ? 'translate-y-[100%] opacity-0' : 'translate-y-0 opacity-100'
          }`}
        >
          {formatCurrency(finalPrice)}
        </span>
      </div>

      {/* Next phase info */}
      {countdownLabel !== null && nextPhase !== null && (
        <div className="mt-3 text-sm text-gray-500">
          <span>{countdownLabel}</span>
          <span className="ml-1 text-gray-400">
            (poté: {PHASE_LABELS[nextPhase]})
          </span>
        </div>
      )}
    </div>
  );
}
