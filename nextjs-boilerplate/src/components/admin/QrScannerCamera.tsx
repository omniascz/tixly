'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Html5Qrcode } from 'html5-qrcode';

/**
 * QrScannerCamera — modal s kamerou pro skenování QR kódů.
 *
 * Dynamicky importuje `html5-qrcode` aby šel SSR-bundle vynechat (lib je
 * ~200kb gzipped a runtime kompatibilní jen v browseru).
 *
 * Po detekci zavolá `onDetected(raw)` s plain stringem (typicky
 * "tixly:<uuid>:<6digit>" nebo holé UUID). Parent rozhodne jak dál.
 *
 * Zavírá se: ESC, klik mimo dialog, ✕ tlačítko nebo successful scan
 * (auto-close, beep).
 */
export function QrScannerCamera({
  open,
  onDetected,
  onClose,
}: {
  open: boolean;
  onDetected: (raw: string) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permState, setPermState] = useState<'prompting' | 'granted' | 'denied'>('prompting');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let beep: AudioContext | null = null;

    async function start() {
      try {
        const mod = await import('html5-qrcode');

        if (cancelled || !containerRef.current) return;

        const scanner = new mod.Html5Qrcode('qr-camera-region');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            // Beep feedback
            try {
              beep = new AudioContext();
              const osc = beep.createOscillator();
              osc.frequency.value = 880;
              osc.connect(beep.destination);
              osc.start();
              osc.stop(beep.currentTime + 0.08);
            } catch {
              // Audio může být zablokované — silent
            }
            onDetected(decodedText);
          },
          () => {
            // Ignoruj per-frame scan failures (běžné když kód není ve viewu)
          },
        );
        setPermState('granted');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/Permission|NotAllowed/i.test(msg)) {
          setPermState('denied');
          setError('Přístup ke kameře odmítnut. Povolte ho v nastavení prohlížeče.');
        } else if (/NotFound|Requested device/i.test(msg)) {
          setError('Kamera nenalezena na tomto zařízení.');
        } else {
          setError(`Chyba kamery: ${msg.slice(0, 200)}`);
        }
      }
    }

    void start();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        void s.stop().then(() => s.clear()).catch(() => undefined);
      }
      if (beep) {
        try {
          void beep.close();
        } catch {
          // ignore
        }
      }
    };
  }, [open, onDetected]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="QR kamera scanner"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sken QR kódu</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 hover:bg-muted"
            aria-label="Zavřít"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          id="qr-camera-region"
          ref={containerRef}
          className="aspect-square w-full overflow-hidden rounded-md bg-black"
        />

        {error ? (
          <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            {error}
            {permState === 'denied' ? (
              <p className="mt-2 text-xs">
                <strong>Co dělat:</strong> v prohlížeči klikni na zámek vlevo
                od URL → Kamera → Povolit. Pak refresh stránky.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Namiř kameru na QR kód. Automaticky se naskenuje.
          </p>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Zavřít
          </button>
        </div>
      </div>
    </div>
  );
}
