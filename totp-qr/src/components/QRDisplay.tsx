"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";

const STEP_SECONDS = 30;

interface QRResponse {
  payload: string;
  expiresAt: number;
  ticketId: string;
}

interface QRDisplayProps {
  ticketId: string;
  eventId: string;
  refreshInterval?: number; // ms, defaults to 30 000
}

interface QRState {
  payload: string | null;
  expiresAt: number | null;
  error: string | null;
  loading: boolean;
}

export function QRDisplay({
  ticketId,
  eventId,
  refreshInterval = STEP_SECONDS * 1000,
}: QRDisplayProps) {
  const [qrState, setQRState] = useState<QRState>({
    payload: null,
    expiresAt: null,
    error: null,
    loading: true,
  });
  const [secondsLeft, setSecondsLeft] = useState<number>(STEP_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQR = useCallback(async () => {
    setQRState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/tickets/${ticketId}/qr`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as QRResponse;
      setQRState({
        payload: data.payload,
        expiresAt: data.expiresAt,
        error: null,
        loading: false,
      });
      // Reset countdown to full step
      setSecondsLeft(STEP_SECONDS);
    } catch (err) {
      setQRState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [ticketId]);

  // Initial load + periodic refresh
  useEffect(() => {
    void fetchQR();

    intervalRef.current = setInterval(() => {
      void fetchQR();
    }, refreshInterval);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQR, refreshInterval]);

  // Countdown ticker (1s granularity)
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? STEP_SECONDS : prev - 1));
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const progressPercent = ((STEP_SECONDS - secondsLeft) / STEP_SECONDS) * 100;

  return (
    // Prevent screenshot-assist via CSS; FLAG_SECURE equivalent on web
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      className="flex flex-col items-center gap-4 p-4"
    >
      {qrState.loading && !qrState.payload && (
        <div className="flex h-64 w-64 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
          Loading…
        </div>
      )}

      {qrState.error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
          <strong>Error:</strong> {qrState.error}
          <button
            onClick={() => void fetchQR()}
            className="ml-3 underline"
          >
            Retry
          </button>
        </div>
      )}

      {qrState.payload && (
        <div className="relative rounded-xl border border-gray-200 p-4 shadow-sm">
          <QRCodeSVG
            value={qrState.payload}
            size={256}
            level="M"
            includeMargin
          />
          {/* Dim overlay while refreshing */}
          {qrState.loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60">
              <span className="text-sm text-gray-500">Refreshing…</span>
            </div>
          )}
        </div>
      )}

      {/* Progress bar countdown */}
      <div className="w-64">
        <div className="mb-1 flex justify-between text-xs text-gray-500">
          <span>Valid for</span>
          <span>{secondsLeft}s</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-1000"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Ticket: {ticketId} · Event: {eventId}
      </p>
    </div>
  );
}
