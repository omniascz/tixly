'use client';

import { useEffect, useState } from 'react';
import type { SeatSelection } from '../../types/seat-map';

interface SeatMapSelectionProps {
  selectedSeats: SeatSelection[];
  onRemove: (seatId: string) => void;
  onConfirm: () => void;
  lockExpiresAt: number | null;
}

function useCountdown(expiresAt: number | null): string | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAt === null) {
      setRemaining(null);
      return;
    }

    const tick = () => {
      const diff = Math.max(0, expiresAt - Date.now());
      setRemaining(diff);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  if (remaining === null) return null;

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function SeatMapSelection({
  selectedSeats,
  onRemove,
  onConfirm,
  lockExpiresAt,
}: SeatMapSelectionProps) {
  const countdown = useCountdown(lockExpiresAt);
  const total = selectedSeats.reduce((sum, s) => sum + s.price, 0);
  const isEmpty = selectedSeats.length === 0;
  const isExpired = lockExpiresAt !== null && lockExpiresAt <= Date.now();

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">
          Vybraná místa{' '}
          {selectedSeats.length > 0 && (
            <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
              {selectedSeats.length}
            </span>
          )}
        </h2>

        {countdown !== null && (
          <div
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${
              isExpired
                ? 'bg-red-100 text-red-700'
                : parseInt(countdown.split(':')[0]!) < 2
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-emerald-100 text-emerald-700'
            }`}
            aria-live="polite"
            aria-label={`Rezervace vyprší za ${countdown}`}
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {isExpired ? 'Vypršela' : `${countdown}`}
          </div>
        )}
      </div>

      {isEmpty ? (
        <p className="py-4 text-center text-sm text-slate-400">
          Klikněte na volné místo v mapě sálu.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {selectedSeats.map((seat) => (
            <li key={seat.seatId} className="flex items-center justify-between py-2">
              <div className="text-sm text-slate-700">
                <span className="font-medium">{seat.seatId}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {seat.price.toLocaleString('cs-CZ')} Kč
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(seat.seatId)}
                  className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={`Odebrat místo ${seat.seatId}`}
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Total */}
      {!isEmpty && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-600">Celkem</span>
          <span className="text-base font-bold text-slate-900">
            {total.toLocaleString('cs-CZ')} Kč
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onConfirm}
        disabled={isEmpty || isExpired}
        className="mt-1 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        aria-disabled={isEmpty || isExpired}
      >
        {isExpired ? 'Rezervace vypršela' : 'Pokračovat k platbě'}
      </button>

      {!isEmpty && countdown !== null && !isExpired && (
        <p className="text-center text-xs text-slate-500">
          Místa rezervována na {countdown}
        </p>
      )}
    </section>
  );
}
