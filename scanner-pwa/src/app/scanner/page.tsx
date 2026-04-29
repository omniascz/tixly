'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { validateScan, type ScanResult } from '../../lib/validator.js';
import {
  getCacheFacade,
  recordScan,
  getPendingScans,
} from '../../lib/offline-cache.js';
import { runSyncCycle, SYNC_INTERVAL_MS } from '../../lib/sync.service.js';
import { useScannerStore } from '../../stores/scanner.store.js';

type FlashState = null | 'green' | 'red';

export default function ScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanningRef = useRef(false);
  const lastDecodedRef = useRef<{ value: string; at: number } | null>(null);

  const [result, setResult] = useState<ScanResult | null>(null);
  const [flash, setFlash] = useState<FlashState>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const isOnline = useScannerStore((s) => s.isOnline);
  const setOnline = useScannerStore((s) => s.setOnline);
  const lastSyncAt = useScannerStore((s) => s.lastSyncAt);
  const setLastSync = useScannerStore((s) => s.setLastSync);
  const pendingScansCount = useScannerStore((s) => s.pendingScansCount);
  const setPendingCount = useScannerStore((s) => s.setPendingCount);
  const addScan = useScannerStore((s) => s.addScan);

  // Online/offline indicator
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [setOnline]);

  // Periodic sync cycle
  useEffect(() => {
    const token = localStorage.getItem('scanner_token') ?? '';
    const eventId = localStorage.getItem('scanner_event_id') ?? '';
    if (!token || !eventId) return;

    let cancelled = false;

    const tick = async () => {
      if (!navigator.onLine) return;
      const r = await runSyncCycle(eventId, token);
      if (cancelled) return;
      setLastSync(Date.now());
      const pending = await getPendingScans();
      setPendingCount(pending.length);
      void r;
    };

    void tick();
    const id = window.setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setLastSync, setPendingCount]);

  // Camera start
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          scanningRef.current = true;
          requestAnimationFrame(scanFrame);
        }
      } catch (err) {
        setCameraError('Kamera není dostupná: ' + (err as Error).message);
      }
    })();
    return () => {
      scanningRef.current = false;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDecoded = useCallback(async (raw: string) => {
    // Debounce identical decodes within 2s
    const now = Date.now();
    if (
      lastDecodedRef.current &&
      lastDecodedRef.current.value === raw &&
      now - lastDecodedRef.current.at < 2000
    ) {
      return;
    }
    lastDecodedRef.current = { value: raw, at: now };

    const eventId = localStorage.getItem('scanner_event_id') ?? '';
    const cache = await getCacheFacade();
    const r = await validateScan(raw, eventId, cache);
    setResult(r);

    // Record scan (queued offline if network down)
    const scanRecord = {
      ticketId: r.type === 'valid' ? r.ticketId : 'unknown',
      scannedAt: now,
      result:
        r.type === 'valid'
          ? ('valid' as const)
          : r.type === 'already_scanned'
          ? ('already_scanned' as const)
          : ('invalid' as const),
      offlineQueued: !navigator.onLine,
    };
    const scanId = await recordScan(scanRecord);
    addScan({ ...scanRecord, scanId });

    if (!navigator.onLine) {
      const pending = await getPendingScans();
      setPendingCount(pending.length);
    }

    // Feedback
    if (r.type === 'valid') {
      setFlash('green');
      if (navigator.vibrate) navigator.vibrate(100);
    } else if (r.type === 'already_scanned') {
      setFlash('red');
      if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    } else {
      setFlash('red');
      if (navigator.vibrate) navigator.vibrate(300);
    }
    window.setTimeout(() => setFlash(null), 700);
  }, [addScan, setPendingCount]);

  const scanFrame = useCallback(() => {
    if (!scanningRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const code = jsQR(img.data, img.width, img.height);
        if (code && code.data) {
          void handleDecoded(code.data);
        }
      }
    }
    requestAnimationFrame(scanFrame);
  }, [handleDecoded]);

  const flashColor =
    flash === 'green' ? 'rgba(0,200,80,0.6)' : flash === 'red' ? 'rgba(220,30,30,0.75)' : 'transparent';

  return (
    <main style={{ position: 'relative', height: '100vh', background: '#000' }}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* flash overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: flashColor,
          pointerEvents: 'none',
          transition: 'background 150ms',
        }}
      />

      {/* status bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: 12,
          display: 'flex',
          justifyContent: 'space-between',
          background: 'rgba(0,0,0,0.5)',
          fontSize: 14,
        }}
      >
        <span style={{ color: isOnline ? '#4ade80' : '#f87171' }}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
        <span>Fronta: {pendingScansCount}</span>
        <span>
          Sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString('cs-CZ') : '—'}
        </span>
      </div>

      {/* result panel */}
      {result && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 20,
            background: 'rgba(0,0,0,0.85)',
            borderTop: `4px solid ${
              result.type === 'valid' ? '#4ade80' : '#f87171'
            }`,
          }}
        >
          {result.type === 'valid' && (
            <>
              <h2 style={{ color: '#4ade80', margin: 0 }}>PLATNÉ</h2>
              <p style={{ margin: '6px 0 0' }}>{result.holderName}</p>
              {result.seatInfo && <p style={{ margin: '4px 0 0', opacity: 0.8 }}>{result.seatInfo}</p>}
            </>
          )}
          {result.type === 'already_scanned' && (
            <>
              <h2 style={{ color: '#f87171', margin: 0 }}>JIŽ SKENOVÁNO!</h2>
              <p style={{ margin: '6px 0 0' }}>
                Předchozí sken: {new Date(result.previouslyScannedAt).toLocaleString('cs-CZ')}
              </p>
            </>
          )}
          {result.type === 'invalid_signature' && (
            <h2 style={{ color: '#f87171', margin: 0 }}>NEPLATNÝ PODPIS</h2>
          )}
          {result.type === 'ticket_not_found' && (
            <h2 style={{ color: '#f87171', margin: 0 }}>LÍSTEK NENALEZEN</h2>
          )}
          {result.type === 'wrong_event' && (
            <h2 style={{ color: '#f87171', margin: 0 }}>ŠPATNÁ AKCE</h2>
          )}
          {result.type === 'ticket_refunded' && (
            <h2 style={{ color: '#f87171', margin: 0 }}>VRÁCENÝ LÍSTEK</h2>
          )}
        </div>
      )}

      {cameraError && (
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, padding: 20, textAlign: 'center' }}>
          {cameraError}
        </div>
      )}
    </main>
  );
}
