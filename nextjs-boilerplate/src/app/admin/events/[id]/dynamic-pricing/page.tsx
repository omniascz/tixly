'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/format';

interface TicketType {
  ticketTypeId: string;
  name: string;
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

export default function DynamicPricingPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      const res = await authFetch(`/api/admin/events/${eventId}/sales-report`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as { byTicketType: TicketType[] };
      setTicketTypes(j.byTicketType ?? []);
    }
  }, [eventId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dynamic pricing"
        description="Cena se automaticky upraví podle demand (velocity) + scarcity (zbývající kapacita). Inspirováno airline pricing — capped uplift."
        actions={
          <Link href={`/admin/events/${eventId}/edit`}>
            <Button variant="outline" size="sm">
              ← Zpět
            </Button>
          </Link>
        }
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {ticketTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Načítání…</p>
      ) : (
        <div className="space-y-4">
          {ticketTypes.map((tt) => (
            <DynamicPricingCard key={tt.ticketTypeId} ticketTypeId={tt.ticketTypeId} name={tt.name} />
          ))}
        </div>
      )}
    </div>
  );
}

interface PreviewSignals {
  velocityPerHour: number;
  scarcityPct: number;
  velocityUpliftPct: number;
  scarcityUpliftPct: number;
  enabled: boolean;
}

interface Preview {
  basePriceMinor: number;
  finalPriceMinor: number;
  upliftPct: number;
  signals: PreviewSignals;
}

interface Rule {
  enabled: boolean;
  min_price_minor: string | number;
  max_price_minor: string | number;
  velocity_threshold_per_hour: number;
  max_uplift_pct: number;
  scarcity_threshold_pct: number;
  scarcity_uplift_pct: number;
}

function DynamicPricingCard({
  ticketTypeId,
  name,
}: {
  ticketTypeId: string;
  name: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [minPrice, setMinPrice] = useState('400');
  const [maxPrice, setMaxPrice] = useState('1000');
  const [velocityThreshold, setVelocityThreshold] = useState('10');
  const [maxUpliftPct, setMaxUpliftPct] = useState('25');
  const [scarcityThresholdPct, setScarcityThresholdPct] = useState('20');
  const [scarcityUpliftPct, setScarcityUpliftPct] = useState('15');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      const res = await authFetch(`/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`);
      if (!res.ok) return;
      const j = (await res.json()) as { rule: Rule | null; preview: Preview };
      setPreview(j.preview);
      if (j.rule) {
        setEnabled(j.rule.enabled);
        setMinPrice(String(Number(j.rule.min_price_minor) / 100));
        setMaxPrice(String(Number(j.rule.max_price_minor) / 100));
        setVelocityThreshold(String(j.rule.velocity_threshold_per_hour));
        setMaxUpliftPct(String(j.rule.max_uplift_pct));
        setScarcityThresholdPct(String(j.rule.scarcity_threshold_pct));
        setScarcityUpliftPct(String(j.rule.scarcity_uplift_pct));
      } else {
        // Default min/max kolem base price
        const base = j.preview.basePriceMinor;
        if (base > 0) {
          setMinPrice(String((base * 0.8) / 100));
          setMaxPrice(String((base * 1.5) / 100));
        }
      }
    }
  }, [ticketTypeId]);

  async function save() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          minPriceMinor: Math.round(Number(minPrice) * 100),
          maxPriceMinor: Math.round(Number(maxPrice) * 100),
          velocityThresholdPerHour: Number(velocityThreshold),
          maxUpliftPct: Number(maxUpliftPct),
          scarcityThresholdPct: Number(scarcityThresholdPct),
          scarcityUpliftPct: Number(scarcityUpliftPct),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { preview?: Preview; error?: string };
      if (!res.ok) {
        setFeedback(j.error ?? `HTTP ${res.status}`);
        return;
      }
      if (j.preview) setPreview(j.preview);
      setFeedback('Uloženo.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!confirm('Smazat dynamic pricing rule?')) return;
    await authFetch(`/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`, {
      method: 'DELETE',
    });
    setEnabled(false);
    const res = await authFetch(`/api/admin/ticket-types/${ticketTypeId}/dynamic-pricing`);
    if (res.ok) {
      const j = (await res.json()) as { preview: Preview };
      setPreview(j.preview);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{name}</span>
          {preview && preview.signals.enabled ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              aktivní
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              vypnuto
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Zapnout dynamic pricing pro tento ticket type
        </label>

        {preview ? (
          <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-4">
            <Stat label="Base cena" value={formatMoney(preview.basePriceMinor, 'CZK')} />
            <Stat
              label="Aktuální cena"
              value={formatMoney(preview.finalPriceMinor, 'CZK')}
              highlight={preview.upliftPct > 0}
            />
            <Stat label="Uplift" value={`+${preview.upliftPct}%`} />
            <Stat
              label="Velocity"
              value={`${preview.signals.velocityPerHour}/h`}
              sub={`scarcity ${preview.signals.scarcityPct}%`}
            />
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field
            label="Min cena (CZK)"
            value={minPrice}
            onChange={setMinPrice}
            disabled={!enabled}
          />
          <Field
            label="Max cena (CZK)"
            value={maxPrice}
            onChange={setMaxPrice}
            disabled={!enabled}
          />
          <Field
            label="Velocity threshold (orders/h)"
            value={velocityThreshold}
            onChange={setVelocityThreshold}
            disabled={!enabled}
          />
          <Field
            label="Max uplift %"
            value={maxUpliftPct}
            onChange={setMaxUpliftPct}
            disabled={!enabled}
          />
          <Field
            label="Scarcity threshold %"
            value={scarcityThresholdPct}
            onChange={setScarcityThresholdPct}
            disabled={!enabled}
          />
          <Field
            label="Scarcity uplift %"
            value={scarcityUpliftPct}
            onChange={setScarcityUpliftPct}
            disabled={!enabled}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy}>
            {busy ? 'Ukládám…' : 'Uložit'}
          </Button>
          {preview && preview.signals.enabled ? (
            <Button onClick={disable} variant="outline">
              Smazat rule
            </Button>
          ) : null}
          {feedback ? <span className="text-xs text-muted-foreground">{feedback}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs uppercase text-muted-foreground">{label}</label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-lg font-bold tabular-nums ${highlight ? 'text-amber-700' : ''}`}
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
