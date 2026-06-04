'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { Card } from '@/components/ui/card';

interface GroupQrResponse {
  token: string;
  expiresAt: number;
  eventTitle: string;
  validCount: number;
  totalCount: number;
  refreshInSeconds: number;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export function GroupQrClient({ orderId, locale }: { orderId: string; locale: string }) {
  const [data, setData] = useState<GroupQrResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(50);
  const [qr, setQr] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function fetchToken() {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await authFetch(`/api/buyer/orders/${orderId}/group-qr`);
      if (res.status === 401) { setError('Pro zobrazení QR se musíš přihlásit.'); return; }
      if (res.status === 404) { setError('Objednávka nenalezena nebo nemá lístky.'); return; }
      if (!res.ok) { setError(`HTTP ${res.status}`); return; }
      const json = (await res.json()) as GroupQrResponse;
      setData(json);
      setSecondsLeft(json.refreshInSeconds);
      setError(null);
      setQr(await QRCode.toDataURL(json.token, { width: 360, margin: 1, errorCorrectionLevel: 'M' }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
    }
  }

  useEffect(() => { void fetchToken(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId]);
  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => { if (s <= 1) { void fetchToken(); return data?.refreshInSeconds ?? 50; } return s - 1; });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.refreshInSeconds]);

  if (error) {
    return (
      <Card className="space-y-3 p-6">
        <p className="text-sm text-rose-700">{error}</p>
        <Link href={`/${locale}/my-tickets`} className="inline-block text-sm text-primary hover:underline">← Moje lístky</Link>
      </Card>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Načítání…</p>;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Link href={`/${locale}/my-tickets`} className="text-sm text-primary hover:underline">← Moje lístky</Link>
      <Card className="overflow-hidden p-0">
        <div className="bg-emerald-600 px-4 py-3 text-center text-white">
          <div className="text-xs uppercase tracking-wide opacity-80">Tixly · skupinový vstup</div>
          <div className="text-sm font-medium">{data.eventTitle}</div>
        </div>
        <div className="flex items-center justify-center bg-white p-6">
          {qr ? (
            <img src={qr} alt="Skupinový QR" className="h-[320px] w-[320px]" data-testid="group-qr" />
          ) : (
            <div className="flex h-[320px] w-[320px] items-center justify-center text-muted-foreground">…</div>
          )}
        </div>
        <div className="space-y-2 px-4 pb-4">
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-center text-sm font-medium text-emerald-900">
            {data.validCount} {plur(data.validCount)} k odbavení
            {data.totalCount !== data.validCount ? ` (z ${data.totalCount} celkem)` : ''}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Nový kód za</span>
            <span data-testid="group-qr-countdown">{secondsLeft}s</span>
          </div>
        </div>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Jeden QR odbaví celou vaši skupinu. Ukaž ho u vstupu — pořadatel pustí všechny najednou
        (nebo jen ty, co dorazili). QR se mění, screenshot nepomůže.
      </p>
    </div>
  );
}

function plur(n: number): string {
  if (n === 1) return 'lístek';
  if (n >= 2 && n <= 4) return 'lístky';
  return 'lístků';
}
