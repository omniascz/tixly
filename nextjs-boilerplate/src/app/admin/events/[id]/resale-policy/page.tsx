'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Repeat, AlertTriangle, Clock, Percent, Wallet, Package } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface Policy {
  resale_policy: 'enabled' | 'disabled' | 'restricted';
  resale_window_hours_before: number;
  resale_fee_pct: number;
  resale_seller_payout_delay_days: number;
  resale_combo_excluded: boolean;
}

interface Stats {
  activeListings: number;
  soldListings: number;
  totalPayoutsHalire: number;
}

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function ResalePolicyPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    typedGet<{ policy: Policy; stats: Stats }>(`/api/admin/events/${eventId}/resale-policy`)
      .then((d) => { setPolicy(d.policy); setStats(d.stats); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'));
  }, [eventId]);

  async function patch(updates: Partial<{
    resalePolicy: string;
    resaleWindowHoursBefore: number;
    resaleFeePct: number;
    resaleSellerPayoutDelayDays: number;
    resaleComboExcluded: boolean;
  }>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await typedFetch(`/api/admin/events/${eventId}/resale-policy`, {
        method: 'PATCH', body: updates, throwOnError: true,
      });
      const fresh = await typedGet<{ policy: Policy; stats: Stats }>(
        `/api/admin/events/${eventId}/resale-policy`,
      );
      setPolicy(fresh.policy);
      setStats(fresh.stats);
      setSaved(true);
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!policy || !stats) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title="Resale politika"
          description="Eventim fanSALE-style: kdo, kdy a za jakých podmínek může přeprodat lístek"
        />
        <div className="text-sm text-muted-foreground">{error ?? 'Načítám…'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Resale politika"
        description="Eventim fanSALE-style: kdo, kdy a za jakých podmínek může přeprodat lístek"
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Uloženo.</div>
      ) : null}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Aktivní listings</p>
            <p className="mt-1 text-2xl font-bold">{stats.activeListings}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Prodáno</p>
            <p className="mt-1 text-2xl font-bold text-emerald-700">{stats.soldListings}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase text-muted-foreground">Vyplaceno sellerům</p>
            <p className="mt-1 text-2xl font-bold">{fmt(stats.totalPayoutsHalire)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Policy mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Repeat className="h-5 w-5" />
            Režim resale
          </CardTitle>
          <CardDescription>
            Pořadatel rozhoduje, zda lze lístek vůbec přeprodat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: 'enabled', label: 'Povoleno', desc: 'Všechny ticket types lze přeprodat' },
              { v: 'restricted', label: 'Omezeno', desc: 'Jen vybrané ticket types (per type flag)' },
              { v: 'disabled', label: 'Zakázáno', desc: 'Žádný resale (Eventim hot tour)' },
            ].map((opt) => (
              <button
                type="button"
                key={opt.v}
                disabled={busy}
                onClick={() => patch({ resalePolicy: opt.v })}
                className={`rounded-md border p-3 text-left transition ${
                  policy.resale_policy === opt.v
                    ? 'border-primary bg-primary/10'
                    : 'hover:bg-muted/30'
                }`}
              >
                <p className="font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {policy.resale_policy !== 'disabled' ? (
        <Card>
          <CardHeader>
            <CardTitle>Parametry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ParamRow
              icon={<Clock className="h-5 w-5" />}
              label="Resale deadline před akcí"
              description="Listings se po této době auto-uzavřou. Eventim Sheeran scénář: 24 hodin."
              value={policy.resale_window_hours_before}
              suffix="hodin"
              step={6}
              min={0} max={720}
              onChange={(v) => patch({ resaleWindowHoursBefore: v })}
              busy={busy}
            />
            <ParamRow
              icon={<Percent className="h-5 w-5" />}
              label="Resale fee"
              description="Procento z prodejní ceny, které si Tixly bere ze sale (zbytek seller payout)."
              value={Number(policy.resale_fee_pct)}
              suffix="%"
              step={0.5}
              min={0} max={50}
              onChange={(v) => patch({ resaleFeePct: v })}
              busy={busy}
            />
            <ParamRow
              icon={<Wallet className="h-5 w-5" />}
              label="Payout delay"
              description="Kolik dní po prodeji se vyplatí sellerovi. Eventim: 4 dny po doručení."
              value={policy.resale_seller_payout_delay_days}
              suffix="dní"
              step={1}
              min={0} max={30}
              onChange={(v) => patch({ resaleSellerPayoutDelayDays: v })}
              busy={busy}
            />
            <div className="flex items-start justify-between rounded-md border p-3">
              <div className="flex gap-3">
                <Package className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="font-medium">Vyloučit balíčky z resale</p>
                  <p className="text-xs text-muted-foreground">
                    Combo/bundle tickets nelze prodat samostatně (Eventim policy).
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => patch({ resaleComboExcluded: !policy.resale_combo_excluded })}
                disabled={busy}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  policy.resale_combo_excluded ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  policy.resale_combo_excluded ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-300 bg-amber-50/50">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 text-amber-700" />
            <div>
              <p className="font-semibold">Resale je vypnut</p>
              <p className="text-sm">
                Buyers nemohou lístek nabídnout k dalšímu prodeji. Transfer (přeposlání) je stále možný,
                pokud není zapnut také <code>no_gifting_mode</code> v hot event mode.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ParamRow({
  icon, label, description, value, suffix, step, min, max, onChange, busy,
}: {
  icon: JSX.Element;
  label: string;
  description: string;
  value: number;
  suffix: string;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border p-3">
      <div className="flex gap-3">
        <div className="text-muted-foreground">{icon}</div>
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step={step}
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={busy}
          className="w-24"
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
