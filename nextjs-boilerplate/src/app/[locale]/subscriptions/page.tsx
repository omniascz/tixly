'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, CheckCircle2, AlertTriangle } from 'lucide-react';

interface MySub {
  id: string;
  planId: string;
  planName: string;
  promoterName: string;
  promoterSlug: string;
  priceHalire: number;
  billingCycle: 'monthly' | 'yearly';
  allowancePerPeriod: number;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  consumptionsUsed: number;
  consumptionsRemaining: number;
}

interface AvailablePlan {
  id: string;
  name: string;
  description: string | null;
  priceHalire: number;
  billingCycle: 'monthly' | 'yearly';
  allowancePerPeriod: number;
  promoter: { id: string; name: string; slug: string };
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function SubscriptionsPage({ params }: { params: { locale: string } }) {
  const sp = useSearchParams();
  const promoterSlug = sp.get('p');
  const [mine, setMine] = useState<MySub[]>([]);
  const [available, setAvailable] = useState<AvailablePlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [promoterSlug]);

  async function load() {
    setError(null);
    const url = promoterSlug
      ? `/api/buyer/subscriptions?promoterSlug=${promoterSlug}`
      : `/api/buyer/subscriptions`;
    const res = await authFetch(url);
    if (!res.ok) {
      if (res.status === 401) setError('Pro zobrazení permanentek se musíš přihlásit.');
      return;
    }
    const data = (await res.json()) as { mySubscriptions: MySub[]; availablePlans: AvailablePlan[] };
    setMine(data.mySubscriptions);
    setAvailable(data.availablePlans);
  }

  async function subscribe(planId: string) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await authFetch('/api/buyer/subscriptions', {
        method: 'POST',
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'ALREADY_SUBSCRIBED') {
          setError('Toto předplatné už máš aktivní.');
        } else {
          setError(data.message ?? data.error ?? 'Nepodařilo se předplatit.');
        }
        return;
      }
      setMsg('Předplatné aktivní. (Bez platební brány — demo aktivace zdarma.)');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancel(sub: MySub) {
    if (
      !confirm(
        `Zrušit „${sub.planName}"? Předplatné zůstane aktivní do ${new Date(sub.currentPeriodEnd).toLocaleDateString('cs-CZ')}.`,
      )
    )
      return;
    setBusy(true);
    try {
      await authFetch(`/api/buyer/subscriptions/${sub.id}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function refundProrata(sub: MySub) {
    const refundEst = Math.floor(
      (sub.priceHalire * sub.consumptionsRemaining) / sub.allowancePerPeriod,
    );
    if (
      !confirm(
        `Okamžitě zrušit „${sub.planName}" a vrátit cca ${(refundEst / 100).toLocaleString('cs-CZ')} Kč ` +
          `za ${sub.consumptionsRemaining} nespotřebovaných z ${sub.allowancePerPeriod} lístků?\n\n` +
          `Pokud pořadatel nepovolil self-service refund, bude potřeba kontaktovat ho přímo.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await authFetch(`/api/buyer/subscriptions/${sub.id}/refund-prorata`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Refund selhal');
        return;
      }
      setMsg(data.note);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Permanentky</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {promoterSlug
            ? 'Dostupné permanentky tohoto pořadatele + tvá aktivní.'
            : 'Tvá aktivní předplatná. Konkrétní permanentky najdeš na profilu pořadatele.'}
        </p>
      </div>

      {msg ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden /> {msg}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden /> {error}
        </div>
      ) : null}

      {mine.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Moje permanentky ({mine.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {mine.map((s) => {
                const remPct = (s.consumptionsRemaining / s.allowancePerPeriod) * 100;
                return (
                  <li key={s.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{s.planName}</p>
                        <p className="text-xs text-muted-foreground">
                          <Link
                            href={`/${params.locale}/p/${s.promoterSlug}`}
                            className="hover:underline"
                          >
                            {s.promoterName}
                          </Link>
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <div className="h-2 w-32 overflow-hidden rounded bg-muted">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${remPct}%` }}
                            />
                          </div>
                          <span className="text-xs">
                            {s.consumptionsRemaining} / {s.allowancePerPeriod} zbývá
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <Calendar className="inline h-3 w-3" aria-hidden /> Do{' '}
                          {new Date(s.currentPeriodEnd).toLocaleDateString('cs-CZ')}
                          {s.cancelAtPeriodEnd ? ' · neobnoví se' : ''}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            s.status === 'active'
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {s.status}
                        </span>
                        {s.status === 'active' && !s.cancelAtPeriodEnd ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void cancel(s)}
                              disabled={busy}
                              className="text-xs text-rose-700 hover:underline"
                            >
                              Zrušit obnovení
                            </button>
                            {s.consumptionsRemaining > 0 ? (
                              <button
                                type="button"
                                onClick={() => void refundProrata(s)}
                                disabled={busy}
                                className="text-xs text-rose-700 hover:underline"
                              >
                                Vrátit prorata
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {available.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Dostupné permanentky</CardTitle>
            <CardDescription>Klikni „Předplatit" pro aktivaci.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {available.map((p) => (
                <div key={p.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{p.name}</p>
                  {p.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                  ) : null}
                  <p className="mt-2 text-lg font-semibold">
                    {(p.priceHalire / 100).toLocaleString('cs-CZ')} Kč
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.allowancePerPeriod} lístků / {p.billingCycle === 'yearly' ? 'rok' : 'měsíc'}
                  </p>
                  <Button
                    size="sm"
                    onClick={() => void subscribe(p.id)}
                    disabled={busy}
                    className="mt-3 w-full"
                  >
                    Předplatit
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {mine.length === 0 && available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aktuálně nemáš žádné předplatné. Otevři profil pořadatele (např.{' '}
          <Link
            href={`/${params.locale}/p/divadlo-verze`}
            className="text-primary hover:underline"
          >
            Divadlo Verze
          </Link>
          ) a klikni na „Permanentky".
        </p>
      ) : null}
    </div>
  );
}
