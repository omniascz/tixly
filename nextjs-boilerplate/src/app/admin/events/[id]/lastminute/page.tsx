'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface LastminuteRule {
  id: string;
  event_id: string;
  hours_before: number;
  min_occupancy_pct: number;
  discount_pct: number;
  is_active: boolean;
  triggered_at: string | null;
}

interface EventInfo {
  title: string;
  total_capacity: number;
  base_price_halire: number;
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

export default function LastminutePage() {
  const params = useParams();
  const id = String(params.id);

  const [rule, setRule] = useState<LastminuteRule | null>(null);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [hoursBefore, setHoursBefore] = useState(2);
  const [minOccupancyPct, setMinOccupancyPct] = useState(60);
  const [discountPct, setDiscountPct] = useState(30);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const [ruleRes, evRes] = await Promise.all([
          authFetch(`/api/admin/events/${id}/lastminute`),
          authFetch(`/api/admin/events/${id}`),
        ]);
        if (ruleRes.ok) {
          const j = (await ruleRes.json()) as { rule: LastminuteRule | null };
          if (j.rule) {
            setRule(j.rule);
            setHoursBefore(j.rule.hours_before);
            setMinOccupancyPct(j.rule.min_occupancy_pct);
            setDiscountPct(j.rule.discount_pct);
            setIsActive(j.rule.is_active);
          }
        }
        if (evRes.ok) {
          const ev = (await evRes.json()) as {
            title?: string;
            totalCapacity?: number;
            basePriceHalire?: number;
          };
          setEvent({
            title: ev.title ?? '',
            total_capacity: ev.totalCapacity ?? 300,
            base_price_halire: ev.basePriceHalire ?? 0,
          });
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${id}/lastminute`, {
        method: 'POST',
        body: JSON.stringify({ hoursBefore, minOccupancyPct, discountPct, isActive }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const ruleRes = await authFetch(`/api/admin/events/${id}/lastminute`);
      if (ruleRes.ok) {
        const j = (await ruleRes.json()) as { rule: LastminuteRule | null };
        setRule(j.rule);
      }
      setFeedback('Pravidlo uloženo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    if (!rule) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const next = !rule.is_active;
      const res = await authFetch(`/api/admin/events/${id}/lastminute`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setRule({ ...rule, is_active: next });
      setIsActive(next);
      setFeedback(next ? 'Pravidlo aktivováno.' : 'Pravidlo deaktivováno.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule() {
    if (!rule) return;
    setDeleting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${id}/lastminute`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setRule(null);
      setHoursBefore(2);
      setMinOccupancyPct(60);
      setDiscountPct(30);
      setIsActive(true);
      setFeedback('Pravidlo smazáno.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  const totalCapacity = event?.total_capacity ?? 300;
  const basePriceHalire = event?.base_price_halire ?? 0;

  const filledSeats = Math.round(totalCapacity * (minOccupancyPct / 100));
  const remainingSeats = totalCapacity - filledSeats;
  const discountedPriceHalire = Math.round(basePriceHalire * (1 - discountPct / 100));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Last-minute sleva"
        description="Automatická sleva pro neprodaná místa."
        actions={
          <Link href={`/admin/events/${id}/settings`}>
            <Button variant="outline" size="sm">
              ← Zpět na nastavení
            </Button>
          </Link>
        }
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      {rule ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Aktuální stav
              <Badge variant={rule.is_active ? 'default' : 'secondary'}>
                {rule.is_active ? 'aktivní' : 'neaktivní'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Pravidlo: {rule.is_active ? 'aktivní' : 'neaktivní'}.{' '}
              {rule.hours_before} hod. před začátkem, pokud obsazenost &lt; {rule.min_occupancy_pct} %,
              sleva {rule.discount_pct} %.
            </p>
            <p className="text-muted-foreground">
              Naposledy spuštěno:{' '}
              {rule.triggered_at
                ? new Date(rule.triggered_at).toLocaleString('cs-CZ')
                : 'nikdy'}
            </p>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={toggleActive}
                disabled={saving}
              >
                {rule.is_active ? 'Deaktivovat' : 'Aktivovat'}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={deleteRule}
                disabled={deleting}
              >
                Smazat pravidlo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Aktuální stav</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Pravidlo zatím neexistuje. Vyplň formulář níže a ulož.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pravidlo last-minute slevy</CardTitle>
          <CardDescription>
            Systém kontroluje obsazenost každých 15 minut. Pokud podmínky platí, automaticky sníží
            ceny všech typů vstupenek — jednou, nevratně.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Hodin před začátkem
            </label>
            <Input
              type="number"
              min={1}
              max={72}
              value={hoursBefore}
              onChange={(e) => setHoursBefore(Number(e.target.value))}
              className="max-w-32"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Kontrola se spustí, pokud do začátku zbývá méně než tento čas (1–72 hodin).
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Minimální obsazenost %
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={99}
                value={minOccupancyPct}
                onChange={(e) => setMinOccupancyPct(Number(e.target.value))}
                className="w-48"
              />
              <Input
                type="number"
                min={1}
                max={99}
                value={minOccupancyPct}
                onChange={(e) => setMinOccupancyPct(Number(e.target.value))}
                className="max-w-24"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Pokud je sál zaplněn méně než {minOccupancyPct} %, sleva se aktivuje.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Výše slevy %
            </label>
            <Input
              type="number"
              min={5}
              max={70}
              value={discountPct}
              onChange={(e) => setDiscountPct(Number(e.target.value))}
              className="max-w-32"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O kolik procent se sníží základní cena vstupenky (5–70 %).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="isActive"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <label htmlFor="isActive" className="text-sm">
              Aktivovat pravidlo ihned po uložení
            </label>
          </div>

          <Button onClick={save} disabled={saving}>
            {saving ? 'Ukládám…' : rule ? 'Uložit změny' : 'Vytvořit pravidlo'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Náhled kalkulace</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            Sál{' '}
            <span className="font-medium">{totalCapacity} míst</span> je z{' '}
            <span className="font-medium">{minOccupancyPct} %</span> zaplněn
            → obsazeno {filledSeats} míst, zbývá{' '}
            <span className="font-medium">{remainingSeats} míst</span>.
          </p>
          {basePriceHalire > 0 ? (
            <p>
              Za {discountPct}% slevu:{' '}
              <span className="font-medium line-through text-muted-foreground">
                {(basePriceHalire / 100).toLocaleString('cs-CZ')} Kč
              </span>{' '}
              →{' '}
              <span className="font-semibold text-emerald-700">
                {(discountedPriceHalire / 100).toLocaleString('cs-CZ')} Kč
              </span>{' '}
              / lístek.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Cena vstupenky se načte z akce — náhled ceny bude viditelný po načtení.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
