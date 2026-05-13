'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { Card } from '@/components/ui/card';

interface TotpResponse {
  ticketId: string;
  code: string;
  expiresInSec: number;
  step: number;
  payload: string;
  status: string;
}

function authFetch(url: string): Promise<Response> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export function LiveQrClient({
  ticketId,
  locale,
}: {
  ticketId: string;
  locale: string;
}) {
  const [data, setData] = useState<TotpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(30);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    void fetchCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function fetchCode() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await authFetch(`/api/buyer/tickets/${ticketId}/totp`);
      if (res.status === 401) {
        setError('Pro zobrazení QR se musíš přihlásit.');
        return;
      }
      if (res.status === 403) {
        setError('Tento lístek nepatří tobě.');
        return;
      }
      if (res.status === 404) {
        setError('Lístek nenalezen.');
        return;
      }
      if (res.status === 410) {
        setError('Lístek byl zrušen (refund/transfer).');
        return;
      }
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as TotpResponse;
      setData(json);
      setSecondsLeft(json.expiresInSec);
      setError(null);
      const qr = await QRCode.toDataURL(json.payload, {
        width: 360,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      setQrDataUrl(qr);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlightRef.current = false;
    }
  }

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          void fetchCode();
          return data ? data.step : 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.step]);

  if (error) {
    return (
      <Card className="space-y-3 p-6">
        <p className="text-sm text-rose-700">{error}</p>
        <Link
          href={`/${locale}/my-tickets`}
          className="inline-block text-sm text-primary hover:underline"
        >
          ← Zpět na moje lístky
        </Link>
      </Card>
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="totp-loading">
        Načítání…
      </p>
    );
  }

  const stepPct = (secondsLeft / data.step) * 100;
  const isUsed = data.status === 'used';

  return (
    <div className="space-y-4">
      <Link
        href={`/${locale}/my-tickets`}
        className="text-sm text-primary hover:underline"
      >
        ← Moje lístky
      </Link>

      <Card className="overflow-hidden p-0">
        <div
          className={`px-4 py-3 text-center text-white ${
            isUsed ? 'bg-slate-500' : 'bg-emerald-600'
          }`}
        >
          <div className="text-xs uppercase tracking-wide opacity-80">Tixly</div>
          <div className="text-sm font-medium">
            {isUsed
              ? 'Tento lístek už byl použit'
              : 'Dynamický QR — ukázat při vstupu'}
          </div>
        </div>

        <div className="flex items-center justify-center bg-white p-6">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR kód lístku"
              className="h-[320px] w-[320px]"
              data-testid="ticket-qr"
              data-payload={data.payload}
            />
          ) : (
            <div className="flex h-[320px] w-[320px] items-center justify-center text-muted-foreground">
              …
            </div>
          )}
        </div>

        <div className="space-y-2 px-4 pb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Nový kód za</span>
            <span data-testid="totp-countdown">{secondsLeft}s</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-700 ease-linear"
              style={{ width: `${stepPct}%` }}
            />
          </div>
          <div
            className="text-center font-mono text-2xl tracking-widest"
            data-testid="totp-code"
          >
            {data.code}
          </div>
          <div className="text-center text-[11px] text-muted-foreground">
            Lístek:{' '}
            <span className="font-mono" data-testid="ticket-id-short">
              {data.ticketId.slice(0, 8)}…
            </span>
          </div>
        </div>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        QR se mění každých {data.step} sekund. Screenshot nepomůže —
        pořadatelův scanner přijme jen aktuální okno (±1).
      </p>

      <div className="grid grid-cols-1 gap-2">
        <GoogleWalletButton ticketId={data.ticketId} />
        <AppleWalletButton ticketId={data.ticketId} />
      </div>
    </div>
  );
}

function AppleWalletButton({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setWarning(null);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/buyer/tickets/${ticketId}/wallet/apple`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        setWarning('Pas se nepodařilo vygenerovat.');
        return;
      }
      const signed = res.headers.get('X-Wallet-Signed') === 'true';
      if (!signed) {
        setWarning('Demo pas — iOS Wallet ho odmítne (chybí Apple Pass Type ID certifikát).');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ticket-${ticketId.slice(0, 8)}.pkpass`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-3 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-60"
      >
        <span className="text-base"></span>
        {busy ? 'Připravuji…' : 'Přidat do Apple Wallet'}
      </button>
      {warning ? <p className="text-center text-xs text-amber-700">{warning}</p> : null}
    </div>
  );
}

function GoogleWalletButton({ ticketId }: { ticketId: string }) {
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  async function addToWallet() {
    setBusy(true);
    setWarning(null);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/buyer/tickets/${ticketId}/wallet/google`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        setWarning('Pas se nepodařilo vygenerovat.');
        return;
      }
      const data = (await res.json()) as { saveUrl: string; signed: boolean; note?: string };
      if (!data.signed) {
        setWarning('Demo pas — Google Wallet ho odmítne (chybí produkční podpis).');
      }
      window.location.href = data.saveUrl;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={addToWallet}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-black px-4 py-3 text-sm font-medium text-white hover:bg-black/90 disabled:opacity-60"
      >
        <span className="text-base">📱</span>
        {busy ? 'Připravuji…' : 'Přidat do Google Wallet'}
      </button>
      {warning ? <p className="text-center text-xs text-amber-700">{warning}</p> : null}
    </div>
  );
}
