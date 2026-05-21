'use client';

import { useEffect, useState } from 'react';
import { Apple, Smartphone, Send, X, RotateCw, Nfc, Shield } from 'lucide-react';
import { computeDeviceFingerprint } from '@/lib/safetix/fingerprint';

interface Props {
  ticketId: string;
  eventTitle: string;
  eventDate: string;
  venueName: string | null;
  ticketTypeName: string;
  holderName: string;
  brandColor: string;
  promoterName: string;
  seatLabel: string | null;
  status: string;
}

export function MobileTicketView(props: Props): JSX.Element {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [nfcOpen, setNfcOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [bindingWarning, setBindingWarning] = useState<string | null>(null);

  useEffect(() => {
    // Wake-lock pro screen brightness na iOS standalone PWA
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').catch(() => null);
    }

    // Device binding — first-view fingerprint lock
    void (async () => {
      try {
        const fp = await computeDeviceFingerprint();
        const r = await fetch(`/api/buyer/tickets/${props.ticketId}/bind-device`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fingerprint: fp }),
        });
        if (r.status === 409) {
          const data = await r.json() as { message?: string };
          setBindingWarning(data.message ?? 'Lístek je svázán s jiným zařízením.');
        }
      } catch {
        // silent
      }
    })();

    // Tick clock pro watermark
    const clockInterval = setInterval(() => setNow(new Date()), 1000);

    // Fetch dynamic rotating QR
    let cancelled = false;
    async function loadQr() {
      try {
        const r = await fetch(`/api/buyer/tickets/${props.ticketId}/qr-image`);
        if (!r.ok) return;
        const blob = await r.blob();
        if (!cancelled) setQrUrl(URL.createObjectURL(blob));
      } catch {
        // ignore
      }
    }
    void loadQr();
    const interval = setInterval(() => {
      if (qrUrl) URL.revokeObjectURL(qrUrl);
      void loadQr();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(clockInterval);
      if (qrUrl) URL.revokeObjectURL(qrUrl);
    };
  }, [props.ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  const date = new Date(props.eventDate);
  const dateLabel = date.toLocaleDateString('cs-CZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const timeLabel = date.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });

  async function addToAppleWallet(): Promise<void> {
    window.location.href = `/api/buyer/tickets/${props.ticketId}/wallet/apple`;
  }

  async function addToGoogleWallet(): Promise<void> {
    try {
      const r = await fetch(`/api/buyer/tickets/${props.ticketId}/wallet/google`);
      const data = await r.json() as { saveUrl?: string; error?: string };
      if (data.saveUrl) {
        window.location.href = data.saveUrl;
      }
    } catch {
      alert('Nepodařilo se vygenerovat Google Wallet pass.');
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ backgroundColor: props.brandColor }}
    >
      {/* Header */}
      <header className="px-5 pt-6 pb-4 text-white">
        <div className="flex items-center justify-between text-xs opacity-80">
          <span className="uppercase tracking-wider">{props.promoterName}</span>
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-full bg-white/20 p-1.5"
            aria-label="Zavřít"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h1 className="mt-3 text-2xl font-bold leading-tight">{props.eventTitle}</h1>
        <p className="mt-1 text-sm opacity-90">{dateLabel}, {timeLabel}</p>
        {props.venueName ? (
          <p className="text-sm opacity-80">{props.venueName}</p>
        ) : null}
      </header>

      {/* Status pill */}
      {props.status !== 'valid' ? (
        <div className="mx-5 rounded-full bg-rose-600 px-3 py-1 text-center text-xs font-semibold text-white">
          Status: {props.status.toUpperCase()}
        </div>
      ) : null}

      {bindingWarning ? (
        <div className="mx-5 my-2 flex items-center gap-2 rounded-md border border-yellow-400 bg-yellow-50 p-2 text-xs text-yellow-900">
          <Shield className="h-4 w-4 flex-shrink-0" />
          <span>{bindingWarning}</span>
        </div>
      ) : null}

      {/* QR card */}
      <main className="flex flex-1 flex-col items-center justify-center px-5">
        <div className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-white">
            {qrUrl ? (
              <img src={qrUrl} alt="QR kód" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <RotateCw className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            )}
            {/* Anti-screenshot watermark — live timestamp + ticket id + holder */}
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-2">
              <p className="rounded bg-white/80 px-2 py-0.5 font-mono text-[9px] text-slate-700">
                {props.holderName.slice(0, 16)} · {now.toLocaleTimeString('cs-CZ')} · {props.ticketId.slice(0, 6)}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-1 text-center">
            <p className="text-xs uppercase tracking-wide text-slate-500">{props.ticketTypeName}</p>
            <p className="font-medium">{props.holderName}</p>
            {props.seatLabel ? (
              <p className="text-sm text-slate-600">{props.seatLabel}</p>
            ) : null}
          </div>
        </div>

        <p className="mt-3 text-center text-xs text-white/70">
          Kód se obměňuje co 30 sekund. Screenshot nepoužitelný — watermark zobrazuje aktuální čas.
        </p>
      </main>

      {/* Actions */}
      <footer className="space-y-2 px-5 pb-8 pt-4">
        <button
          type="button"
          onClick={addToAppleWallet}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white"
        >
          <Apple className="h-4 w-4" /> Přidat do Apple Wallet
        </button>
        <button
          type="button"
          onClick={addToGoogleWallet}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900"
        >
          <Smartphone className="h-4 w-4" /> Přidat do Google Wallet
        </button>
        <button
          type="button"
          onClick={() => setNfcOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/20 px-4 py-3 text-sm font-semibold text-white"
        >
          <Nfc className="h-4 w-4" /> NFC tap-to-enter
        </button>
        <button
          type="button"
          onClick={() => setTransferOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/20 px-4 py-3 text-sm font-semibold text-white"
        >
          <Send className="h-4 w-4" /> Přepošli kamarádovi
        </button>
      </footer>

      {transferOpen ? (
        <TransferSheet
          ticketId={props.ticketId}
          onClose={() => setTransferOpen(false)}
        />
      ) : null}
      {nfcOpen ? (
        <NfcSheet
          ticketId={props.ticketId}
          onClose={() => setNfcOpen(false)}
        />
      ) : null}
    </div>
  );
}

function NfcSheet({ ticketId, onClose }: { ticketId: string; onClose: () => void }): JSX.Element {
  const [token, setToken] = useState<string | null>(null);
  const [ttl, setTtl] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch(`/api/buyer/tickets/${ticketId}/nfc-payload`);
        if (!r.ok) {
          const e = await r.json() as { error?: string };
          throw new Error(e.error ?? `HTTP ${r.status}`);
        }
        const data = await r.json() as { token: string; ttlSeconds: number };
        if (!cancelled) {
          setToken(data.token);
          setTtl(data.ttlSeconds);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Chyba');
      }
    }
    void refresh();
    const interval = setInterval(refresh, 7000);
    const tick = setInterval(() => setTtl((t) => Math.max(0, t - 1)), 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [ticketId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center">
      <div className="w-full rounded-t-3xl bg-white p-6 sm:max-w-sm sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">NFC tap-to-enter</h2>
          <button type="button" onClick={onClose} aria-label="Zavřít">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error ? (
          <p className="text-sm text-rose-700">{error}</p>
        ) : !token ? (
          <p className="text-sm text-slate-500">Generuji…</p>
        ) : (
          <>
            <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-center">
              <Nfc className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="mt-2 text-xs text-emerald-800">
                Přilož telefon ke scanneru u brány. Payload vyprší za <strong>{ttl}s</strong>.
              </p>
            </div>
            <details className="rounded-lg border bg-slate-50 p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Zobrazit token (debug)</summary>
              <p className="mt-2 break-all font-mono text-[10px]">{token}</p>
            </details>
            <p className="mt-3 text-center text-[10px] text-slate-500">
              Native app zapíše token do NFC tag emulation. PWA: scanner musí umět číst přes Web NFC API.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TransferSheet({ ticketId, onClose }: { ticketId: string; onClose: () => void }): JSX.Element {
  const [toEmail, setToEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ inviteUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/buyer/tickets/${ticketId}/transfer-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail, message: message || undefined }),
      });
      if (!r.ok) {
        const e = await r.json() as { error?: string };
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as { inviteUrl: string };
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 sm:items-center sm:justify-center">
      <div className="w-full rounded-t-3xl bg-white p-6 sm:max-w-sm sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Přepošli lístek</h2>
          <button type="button" onClick={onClose} aria-label="Zavřít">
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          <div>
            <p className="text-sm">Lístek je připraven k převzetí. Pošli příjemci tento link:</p>
            <div className="mt-3 break-all rounded-lg bg-slate-100 p-3 font-mono text-xs">
              {result.inviteUrl}
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(result.inviteUrl).then(() => onClose())}
              className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
            >
              Zkopírovat link
            </button>
          </div>
        ) : (
          <>
            <label className="block text-xs font-medium">Email příjemce</label>
            <input
              type="email"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder="kamarad@example.com"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <label className="mt-3 block text-xs font-medium">Zpráva (volitelně)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {error ? (
              <p className="mt-2 text-xs text-rose-600">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={send}
              disabled={busy || !toEmail}
              className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Odesílám…' : 'Vygenerovat pozvánku'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
