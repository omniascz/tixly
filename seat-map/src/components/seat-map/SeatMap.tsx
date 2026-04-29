'use client';

import { useCallback, useEffect } from 'react';
import { useSeatMap } from '../../hooks/useSeatMap';
import type { Seat, SeatSelection, Zone } from '../../types/seat-map';
import { SeatMapLegend } from './SeatMapLegend';
import { SeatMapSelection } from './SeatMapSelection';
import { SeatMapSVG } from './SeatMapSVG';

interface SeatMapProps {
  eventId: string;
  ticketTypeId: string;
  onSelectionChange: (seats: SeatSelection[]) => void;
  maxSeats?: number;
  onConflict?: (message: string) => void;
}

function SeatMapSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-slate-200" />
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="h-96 rounded-xl bg-slate-200" />
        <div className="space-y-3">
          <div className="h-48 rounded-xl bg-slate-200" />
          <div className="h-32 rounded-xl bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function SeatMapError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
      <svg
        className="h-5 w-5 flex-shrink-0 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <p className="text-sm text-red-700">{message}</p>
    </div>
  );
}

export function SeatMap({
  eventId,
  ticketTypeId,
  onSelectionChange,
  maxSeats = 10,
  onConflict,
}: SeatMapProps) {
  const {
    seatMap,
    selectedSeats,
    isLoading,
    error,
    selectSeat,
    deselectSeat,
    clearSelection,
    lockExpiresAt,
  } = useSeatMap(eventId);

  // Propagate selection changes to parent
  useEffect(() => {
    onSelectionChange(selectedSeats);
  }, [selectedSeats, onSelectionChange]);

  const handleSeatClick = useCallback(
    async (seat: Seat) => {
      // Deselect if already selected
      if (seat.status === 'selected') {
        await deselectSeat(seat.id);
        return;
      }

      if (selectedSeats.length >= maxSeats) {
        onConflict?.(`Maximální počet vybraných míst je ${maxSeats}.`);
        return;
      }

      const result = await selectSeat(seat, ticketTypeId);
      if (result.conflict) {
        onConflict?.('Místo bylo právě obsazeno jiným zákazníkem.');
      }
    },
    [selectedSeats.length, maxSeats, selectSeat, deselectSeat, ticketTypeId, onConflict],
  );

  const handleConfirm = useCallback(() => {
    // In production: navigate to checkout with selectedSeats in cart context
    // For now: trigger parent callback (consumer handles navigation)
    onSelectionChange(selectedSeats);
  }, [selectedSeats, onSelectionChange]);

  if (isLoading) return <SeatMapSkeleton />;

  if (error) {
    return <SeatMapError message={`Nepodařilo se načíst mapu sálu: ${error.message}`} />;
  }

  if (!seatMap) return null;

  // Collect unique zones across all sections for legend
  const zonesMap = new Map<string, Zone>();
  for (const section of seatMap.sections) {
    for (const seat of section.seats) {
      if (!zonesMap.has(seat.zone.id)) {
        zonesMap.set(seat.zone.id, seat.zone);
      }
    }
  }
  const zones = Array.from(zonesMap.values());

  const selectedSeatIds = new Set(selectedSeats.map((s) => s.seatId));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{seatMap.venueName}</h2>
        <p className="text-sm text-slate-500">
          Vyberte místa kliknutím. Označená místa jsou rezervována po dobu 7 minut.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Map */}
        <div className="space-y-4">
          <SeatMapSVG
            seatMap={seatMap}
            selectedSeatIds={selectedSeatIds}
            onSeatClick={(seat) => void handleSeatClick(seat)}
          />
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <SeatMapSelection
            selectedSeats={selectedSeats}
            onRemove={(id) => void deselectSeat(id)}
            onConfirm={handleConfirm}
            lockExpiresAt={lockExpiresAt}
          />
          <SeatMapLegend zones={zones} />
        </div>
      </div>
    </div>
  );
}
