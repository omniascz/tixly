'use client';

import { useEffect, useState } from 'react';

/**
 * PWA Install prompt — DACH P2-5 (Tixly diferenciátor).
 *
 * Android Chrome: capture `beforeinstallprompt` event → tlačítko "Nainstalovat".
 * iOS Safari: žádný native event, ukáže hint "Klikni Share → Přidat na plochu".
 *
 * Banner se objeví max 1× za 30 dní (localStorage tixly.install-dismissed-at)
 * + jen pokud user není už standalone (display-mode: standalone).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'tixly.install-dismissed-at';
const DISMISS_DAYS = 30;

function shouldShow(): boolean {
  if (typeof window === 'undefined') return false;

  // V iframe (embed widget na cizím webu) nemá PWA install prompt co dělat.
  try { if (window.self !== window.top) return false; } catch { return false; }

  // Už spuštěno jako PWA?
  if (window.matchMedia('(display-mode: standalone)').matches) return false;
  // iOS Safari standalone check
  if ((window.navigator as { standalone?: boolean }).standalone === true) return false;

  const dismissedAt = localStorage.getItem(DISMISS_KEY);
  if (!dismissedAt) return true;
  const elapsed = Date.now() - Number(dismissedAt);
  return elapsed > DISMISS_DAYS * 24 * 3600 * 1000;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function InstallPrompt(): JSX.Element | null {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!shouldShow()) {
      setDismissed(true);
      return;
    }

    if (isIOS()) {
      // Delay aby buyer viděl prvně content
      const t = setTimeout(() => setShowIOSHint(true), 5000);
      return () => clearTimeout(t);
    }

    function onBeforeInstall(e: Event): void {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, []);

  function dismiss(): void {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
    setDeferredEvent(null);
    setShowIOSHint(false);
  }

  async function handleInstall(): Promise<void> {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferredEvent(null);
    } else {
      dismiss();
    }
  }

  if (dismissed) return null;

  if (deferredEvent) {
    return (
      <div
        className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-lg border bg-card p-4 shadow-lg"
        data-testid="install-prompt-android"
      >
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="Tixly" className="h-10 w-10 rounded-md" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Nainstalovat Tixly</p>
            <p className="text-xs text-muted-foreground">
              Rychlý přístup ke vstupenkám i offline. Zabere 0,5 MB.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Zavřít"
          >
            ×
          </button>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50"
          >
            Ne teď
          </button>
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            data-testid="install-prompt-accept"
          >
            Nainstalovat
          </button>
        </div>
      </div>
    );
  }

  if (showIOSHint) {
    return (
      <div
        className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-lg border bg-card p-4 shadow-lg"
        data-testid="install-prompt-ios"
      >
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="Tixly" className="h-10 w-10 rounded-md" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">Přidej Tixly na plochu</p>
            <p className="text-xs text-muted-foreground">
              Klepni na <strong>Sdílet</strong> ⬆️ pod stránkou a vyber{' '}
              <strong>Přidat na plochu</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Zavřít"
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return null;
}
