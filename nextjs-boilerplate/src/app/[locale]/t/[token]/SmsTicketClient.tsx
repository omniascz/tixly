'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Card } from '@/components/ui/card';

interface TotpResponse {
  ticketId: string;
  code: string;
  expiresInSec: number;
  step: number;
  payload: string;
  status: string;
  eventTitle: string;
  ticketTypeName: string;
  holderName: string | null;
  eventDate: string | null;
  venueName: string | null;
}

export function SmsTicketClient({ token }: { token: string }) {
  const [data, setData] = useState<TotpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const inFlight = useRef(false);

  useEffect(() => {
    void fetchCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function fetchCode(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/public/tickets/${encodeURIComponent(token)}/totp`);
      if (res.status === 403) {
        setError('Tento odkaz není platný nebo vypršel.');
        return;
      }
      if (res.status === 404) {
        setError('Vstupenka nenalezena.');
        return;
      }
      if (res.status === 410) {
        setError('Vstupenka byla zrušena (refund nebo transfer).');
        return;
      }
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as TotpResponse;
      setData(json);
      setSecondsLeft(json.expiresInSec);
      const qr = await QRCode.toDataURL(json.payload, {
        width: 360,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      setQrUrl(qr);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          void fetchCode();
          return data?.step ?? 30;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.step]);

  if (error) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-rose-700">{error}</p>
      </Card>
    );
  }
  if (!data || !qrUrl) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">Načítám vstupenku…</p>
    );
  }

  const isUsed = data.status === 'used';
  const stepPct = (secondsLeft / data.step) * 100;

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden p-0">
        <div
          className={`px-4 py-3 text-center text-white ${isUsed ? 'bg-slate-500' : 'bg-emerald-600'}`}
        >
          <div className="text-xs uppercase tracking-wide opacity-80">Tixly · SMS vstupenka</div>
          <div className="text-base font-medium">{data.eventTitle}</div>
        </div>

        <div className="flex items-center justify-center bg-white p-6">
          <img src={qrUrl} alt="QR kód" className="h-72 w-72" />
        </div>

        <div className="space-y-2 px-4 pb-4">
          <div className="text-center text-sm">
            <strong>{data.ticketTypeName}</strong>
            {data.holderName ? <> · {data.holderName}</> : null}
          </div>
          {data.venueName ? (
            <div className="text-center text-xs text-muted-foreground">
              {data.venueName}
              {data.eventDate
                ? ` · ${new Date(data.eventDate).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' })}`
                : ''}
            </div>
          ) : null}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Nový kód za</span>
            <span>{secondsLeft}s</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-700 ease-linear"
              style={{ width: `${stepPct}%` }}
            />
          </div>
          <div className="text-center font-mono text-2xl tracking-widest">{data.code}</div>
          {isUsed ? (
            <p className="text-center text-xs text-rose-700">⚠ Tento lístek už byl použit.</p>
          ) : null}
        </div>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        QR se mění každých {data.step} sekund. Screenshot nepomůže — pořadatelův scanner
        přijme jen aktuální okno (±1).
      </p>
    </div>
  );
}
