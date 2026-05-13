"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Html5QrcodeScanner, Html5QrcodeScanType } from "html5-qrcode";
import { validateOffline } from "../services/validator.service";
import { initDB } from "../db/offline-cache";
import { fullSync, startDeltaSyncLoop } from "../services/sync.service";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanStatus = "idle" | "ok" | "error";

interface ScanDisplay {
  status: ScanStatus;
  heading: string;
  detail: string;
}

// ---------------------------------------------------------------------------
// Config (would be env vars in production)
// ---------------------------------------------------------------------------

const EVENT_ID = process.env.NEXT_PUBLIC_EVENT_ID ?? "";
const AUTH_TOKEN = process.env.NEXT_PUBLIC_GATE_TOKEN ?? "";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScannerPage() {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const scannerDivRef = useRef<HTMLDivElement | null>(null);
  const [scanDisplay, setScanDisplay] = useState<ScanDisplay>({
    status: "idle",
    heading: "Ready to scan",
    detail: "Point camera at ticket QR code",
  });
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const lastSyncTimeRef = useRef<number>(Math.floor(Date.now() / 1000) - 300);
  const processingRef = useRef(false);

  // --- DB init + initial sync ---
  useEffect(() => {
    initDB();

    void fullSync(EVENT_ID, AUTH_TOKEN)
      .then(() => {
        lastSyncTimeRef.current = Math.floor(Date.now() / 1000);
      })
      .catch(() => {
        // continue offline with whatever is already cached
      });

    startDeltaSyncLoop(
      EVENT_ID,
      AUTH_TOKEN,
      () => lastSyncTimeRef.current
    );

    // Online/offline banner
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // --- QR scanner setup ---
  const onScanSuccess = useCallback(
    async (decodedText: string) => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const result = await validateOffline(decodedText, EVENT_ID);
        if (result.success) {
          setScanDisplay({
            status: "ok",
            heading: result.holderName || "Valid Ticket",
            detail: result.seatInfo,
          });
        } else {
          setScanDisplay({
            status: "error",
            heading: "Invalid Ticket",
            detail: result.error ?? "Unknown error",
          });
        }
      } catch {
        setScanDisplay({
          status: "error",
          heading: "Scan Error",
          detail: "Could not process QR code",
        });
      }

      // Reset to idle after 3 seconds
      setTimeout(() => {
        processingRef.current = false;
        setScanDisplay({
          status: "idle",
          heading: "Ready to scan",
          detail: "Point camera at ticket QR code",
        });
      }, 3000);
    },
    []
  );

  useEffect(() => {
    if (!scannerDivRef.current) return;

    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      {
        fps: 10,
        qrbox: { width: 280, height: 280 },
        supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
        rememberLastUsedCamera: true,
      },
      /* verbose= */ false
    );

    scanner.render(
      (text) => void onScanSuccess(text),
      (_err) => {
        // frame-level decode errors are noisy — suppress
      }
    );

    scannerRef.current = scanner;

    return () => {
      void scanner.clear().catch(() => {});
    };
  }, [onScanSuccess]);

  // --- Styles ---
  const resultBg =
    scanDisplay.status === "ok"
      ? "bg-green-500"
      : scanDisplay.status === "error"
      ? "bg-red-500"
      : "bg-gray-800";

  return (
    <main className="flex min-h-screen flex-col items-center bg-gray-900 text-white">
      {/* Offline banner */}
      {!isOnline && (
        <div className="w-full bg-yellow-500 py-2 text-center text-sm font-medium text-yellow-900">
          Offline mode — using local cache
        </div>
      )}

      <header className="flex w-full items-center justify-between px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">
          Tixly Scanner
        </h1>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            isOnline ? "bg-green-700 text-green-100" : "bg-gray-600 text-gray-200"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              isOnline ? "bg-green-300" : "bg-gray-400"
            }`}
          />
          {isOnline ? "Online" : "Offline"}
        </span>
      </header>

      {/* Camera viewfinder */}
      <div className="w-full max-w-md px-4">
        <div ref={scannerDivRef} id="qr-reader" className="overflow-hidden rounded-xl" />
      </div>

      {/* Result card */}
      <div
        className={`mt-6 w-full max-w-md rounded-2xl px-6 py-5 text-center transition-colors duration-300 ${resultBg}`}
      >
        <p className="text-2xl font-bold">{scanDisplay.heading}</p>
        <p className="mt-1 text-sm opacity-80">{scanDisplay.detail}</p>
      </div>
    </main>
  );
}
