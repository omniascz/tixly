'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mergeSeatStatuses, parseSeatMapJSON } from '../lib/seat-map-parser';
import type { Seat, SeatMap, SeatSelection, SeatStatus } from '../types/seat-map';

interface LockResponse {
  success: boolean;
  lockedUntil?: number;
  conflictingSeatIds?: string[];
}

async function fetchSeatMap(eventId: string): Promise<SeatMap> {
  const res = await fetch(`/api/events/${eventId}/seat-map`);
  if (!res.ok) throw new Error(`Failed to fetch seat map: ${res.status}`);
  const json: unknown = await res.json();
  return parseSeatMapJSON(json);
}

async function fetchSeatStatuses(eventId: string): Promise<Record<string, SeatStatus>> {
  const res = await fetch(`/api/events/${eventId}/seats/status`);
  if (!res.ok) throw new Error(`Failed to fetch seat statuses: ${res.status}`);
  return res.json() as Promise<Record<string, SeatStatus>>;
}

async function lockSeats(
  eventId: string,
  seatIds: string[],
  orderId: string,
): Promise<LockResponse> {
  const res = await fetch(`/api/events/${eventId}/seats/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatIds, orderId }),
  });
  if (!res.ok) throw new Error(`Lock request failed: ${res.status}`);
  return res.json() as Promise<LockResponse>;
}

async function unlockSeats(
  eventId: string,
  seatIds: string[],
  orderId: string,
): Promise<void> {
  await fetch(`/api/events/${eventId}/seats/lock`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatIds, orderId }),
  });
}

export interface UseSeatMapReturn {
  seatMap: SeatMap | undefined;
  selectedSeats: SeatSelection[];
  isLoading: boolean;
  error: Error | null;
  selectSeat: (seat: Seat, ticketTypeId: string) => Promise<{ conflict: boolean }>;
  deselectSeat: (seatId: string) => Promise<void>;
  clearSelection: () => Promise<void>;
  lockExpiresAt: number | null;
}

// Stable orderId per session (in production this would come from cart/order context)
function getSessionOrderId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = sessionStorage.getItem('seat-order-id');
  if (!id) {
    id = `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('seat-order-id', id);
  }
  return id;
}

export function useSeatMap(eventId: string): UseSeatMapReturn {
  const queryClient = useQueryClient();
  const [selectedSeats, setSelectedSeats] = useState<SeatSelection[]>([]);
  const [lockExpiresAt, setLockExpiresAt] = useState<number | null>(null);

  const seatMapQuery = useQuery<SeatMap, Error>({
    queryKey: ['seatMap', eventId],
    queryFn: () => fetchSeatMap(eventId),
    staleTime: 5 * 60 * 1000,
  });

  const statusQuery = useQuery<Record<string, SeatStatus>, Error>({
    queryKey: ['seatStatuses', eventId],
    queryFn: () => fetchSeatStatuses(eventId),
    refetchInterval: 3000,
    enabled: !!seatMapQuery.data,
    select: (statuses) => statuses,
  });

  // Merge statuses into seatMap
  const seatMap: SeatMap | undefined = (() => {
    if (!seatMapQuery.data) return undefined;
    if (!statusQuery.data) return seatMapQuery.data;
    // Apply selected seats on top of server statuses
    const selectedIds = new Set(selectedSeats.map((s) => s.seatId));
    const mergedStatuses: Record<string, SeatStatus> = { ...statusQuery.data };
    for (const id of selectedIds) {
      mergedStatuses[id] = 'selected';
    }
    return mergeSeatStatuses(seatMapQuery.data, mergedStatuses);
  })();

  const lockMutation = useMutation<LockResponse, Error, { seatIds: string[]; orderId: string }>({
    mutationFn: ({ seatIds, orderId }) => lockSeats(eventId, seatIds, orderId),
  });

  const selectSeat = useCallback(
    async (seat: Seat, ticketTypeId: string): Promise<{ conflict: boolean }> => {
      const orderId = getSessionOrderId();
      const result = await lockMutation.mutateAsync({ seatIds: [seat.id], orderId });

      if (!result.success) {
        // Race condition: seat was locked by someone else between click and API call
        // Invalidate statuses so UI updates immediately
        void queryClient.invalidateQueries({ queryKey: ['seatStatuses', eventId] });
        return { conflict: true };
      }

      if (result.lockedUntil) {
        setLockExpiresAt((prev) =>
          // Keep the earliest expiry (first selected seat sets the countdown)
          prev === null ? result.lockedUntil! : Math.min(prev, result.lockedUntil!),
        );
      }

      setSelectedSeats((prev) => [
        ...prev,
        { seatId: seat.id, ticketTypeId, price: seat.zone.price },
      ]);

      return { conflict: false };
    },
    [lockMutation, queryClient, eventId],
  );

  const deselectSeat = useCallback(
    async (seatId: string): Promise<void> => {
      const orderId = getSessionOrderId();
      await unlockSeats(eventId, [seatId], orderId);
      setSelectedSeats((prev) => prev.filter((s) => s.seatId !== seatId));
      void queryClient.invalidateQueries({ queryKey: ['seatStatuses', eventId] });
      setLockExpiresAt((prev) => {
        // Reset timer only when all seats deselected
        return prev;
      });
    },
    [queryClient, eventId],
  );

  const clearSelection = useCallback(async (): Promise<void> => {
    const orderId = getSessionOrderId();
    const ids = selectedSeats.map((s) => s.seatId);
    if (ids.length > 0) {
      await unlockSeats(eventId, ids, orderId);
    }
    setSelectedSeats([]);
    setLockExpiresAt(null);
    void queryClient.invalidateQueries({ queryKey: ['seatStatuses', eventId] });
  }, [selectedSeats, queryClient, eventId]);

  const error = seatMapQuery.error ?? statusQuery.error ?? null;

  return {
    seatMap,
    selectedSeats,
    isLoading: seatMapQuery.isLoading,
    error,
    selectSeat,
    deselectSeat,
    clearSelection,
    lockExpiresAt,
  };
}
