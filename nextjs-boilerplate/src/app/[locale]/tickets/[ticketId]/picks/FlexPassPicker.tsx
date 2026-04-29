'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface DayRow {
  id: string;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
}

interface PicksData {
  ticketId: string;
  passKind: string;
  picksRequired: number | null;
  pickDeadline: string | null;
  days: DayRow[];
  picks: { event_day_id: string; picked_at: string }[];
  usedDayIds: string[];
  locked: boolean;
}

interface Props {
  ticketId: string;
  locale: string;
}

export function FlexPassPicker({ ticketId }: Props) {
  const [data, setData] = useState<PicksData | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/buyer/tickets/${ticketId}/picks`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as PicksData;
        setData(json);
        setSelected(new Set(json.picks.map((p) => p.event_day_id)));
      } catch (e) {
        setError((e as Error).message);
      }
    }
    void load();
  }, [ticketId]);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        Chyba: {error}
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }
  if (data.passKind === 'season') {
    return (
      <div className="rounded-md border bg-emerald-50 p-4 text-sm text-emerald-900">
        Toto je <strong>season pass</strong> — automaticky pokrývá všechny dny.
        Není potřeba vybírat termíny.
      </div>
    );
  }
  if (data.passKind !== 'flex') {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        Tento ticket není pass — termíny se nevybírají.
      </div>
    );
  }

  const required = data.picksRequired ?? 0;
  const remaining = required - selected.size;
  const deadlinePassed =
    data.pickDeadline !== null && new Date(data.pickDeadline).getTime() < Date.now();
  const alreadyScanned = data.usedDayIds.length > 0;
  const canSave = !saving && !deadlinePassed && !alreadyScanned && selected.size === required;

  function toggle(dayId: string) {
    if (alreadyScanned) return;
    setSaved(false);
    const next = new Set(selected);
    if (next.has(dayId)) {
      next.delete(dayId);
    } else {
      if (next.size >= required) return; // zákaz překročení
      next.add(dayId);
    }
    setSelected(next);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyer/tickets/${ticketId}/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dayIds: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setSaved(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4">
        <div className="text-sm">
          Vyber přesně <strong>{required}</strong> termínů.{' '}
          <span className="text-muted-foreground">
            ({selected.size}/{required} vybráno
            {remaining > 0 ? `, zbývá ${remaining}` : ''})
          </span>
        </div>
        {data.pickDeadline ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Uzávěrka výběru:{' '}
            {new Date(data.pickDeadline).toLocaleString('cs-CZ', {
              dateStyle: 'long',
              timeStyle: 'short',
            })}
          </div>
        ) : null}
      </div>

      {alreadyScanned ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Pass už byl použit ({data.usedDayIds.length}× scannováno) — termíny
          nelze měnit.
        </div>
      ) : null}
      {deadlinePassed && !alreadyScanned ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Uzávěrka výběru proběhla — termíny už nelze měnit.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {data.days.map((d) => {
          const isSelected = selected.has(d.id);
          const isUsed = data.usedDayIds.includes(d.id);
          const isOriginalPick = data.picks.some((p) => p.event_day_id === d.id);
          const disabled = alreadyScanned || deadlinePassed;
          const dim = !isSelected && remaining <= 0;
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              disabled={disabled || (dim && !isSelected)}
              className={[
                'rounded-md border p-3 text-left transition',
                isSelected
                  ? 'border-primary bg-primary/10 ring-1 ring-primary'
                  : dim
                    ? 'border-muted bg-muted/20 text-muted-foreground'
                    : 'border-border bg-background hover:bg-muted/40',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{d.label ?? '—'}</div>
                {isUsed ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                    použito
                  </span>
                ) : isOriginalPick ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                    uloženo
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(d.starts_at).toLocaleString('cs-CZ', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Termíny uloženy.
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={save} disabled={!canSave}>
          {saving ? 'Ukládám…' : 'Uložit výběr'}
        </Button>
      </div>
    </div>
  );
}
