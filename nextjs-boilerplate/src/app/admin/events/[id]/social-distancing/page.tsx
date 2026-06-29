'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

export default function SocialDistancingPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [current, setCurrent] = useState<number>(0);
  const [selected, setSelected] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load() {
    const res = await authFetch(`/api/admin/events/${eventId}/social-distancing`);
    if (res.ok) {
      const j = (await res.json()) as { socialDistanceSeats: number };
      setCurrent(j.socialDistanceSeats);
      setSelected(j.socialDistanceSeats);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/social-distancing`, {
        method: 'PATCH',
        body: JSON.stringify({ seats: selected }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setCurrent(selected);
      setFeedback(selected === 0 ? 'Sociální odstup deaktivován.' : `Sociální odstup nastaven na ${selected} sedadla.`);
    } finally {
      setBusy(false);
    }
  }

  const options = [0, 1, 2, 3, 4, 5] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sociální odstup sedadel"
        description="Automaticky blokuje sedadla příliš blízko ostatních rezervací."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Nastavení odstupu</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Aktuální nastavení: <strong>{current === 0 ? 'Vypnuto' : `${current} volné sedadlo/a vedle`}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSelected(n)}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
                  selected === n
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-muted'
                }`}
              >
                {n === 0 ? 'Vypnuto' : `${n} sedadlo/a`}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Při rezervaci systém ověří, že žádné kupované sedadlo nesousedí ve stejné řadě s již obsazeným sedadlem ve vzdálenosti menší než nastavená hodnota.
          </p>
          <Button onClick={save} disabled={busy || selected === current}>
            {busy ? 'Ukládám…' : 'Uložit nastavení'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
