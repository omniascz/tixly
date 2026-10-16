'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { VisualEditor, type Layout } from './VisualEditor';

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

export default function PlatformVisualEditorPage(_props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = useParams<{ id: string }>();
  const venueId = params.id;
  const [initialLayout, setInitialLayout] = useState<Layout | null>(null);
  const [chartName, setChartName] = useState('Default');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart`);
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          setLoaded(true);
          return;
        }
        const j = (await res.json()) as { chart: { name: string; layout: Layout } | null };
        if (j.chart) {
          setInitialLayout(j.chart.layout);
          setChartName(j.chart.name);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoaded(true);
      }
    }
  }, [venueId]);

  async function save(name: string, layout: Layout) {
    const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, layout }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
            ← Zpět na detail sálu
          </Link>
          <h1 className="mt-1 text-2xl font-bold">🎨 Visual seating editor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag-and-draw nástroj pro nepravidelné sály — divadla, opery, stadiony s elipsou.
            Pro velké stadiony zvaž import přes <Link href={`/platform/venues/${venueId}/seating-chart/import`} className="underline">CSV/SVG/JSON</Link>.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <VisualEditor initialLayout={initialLayout} chartName={chartName} onSave={save} />
    </div>
  );
}
