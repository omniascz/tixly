'use client';

/**
 * /admin/venues/[venueId]/seating-chart/editor
 *
 * Promotér může editovat seating chart svého soukromého sálu (venue.promoter_id = tento promotér).
 * Sdílené sály (promoter_id IS NULL) jsou read-only — editor zobrazí chybu s odkazem na podporu.
 *
 * Reuse: VisualEditor z /platform/venues/[id]/seating-chart/editor/VisualEditor.tsx
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { VisualEditor, type Layout } from '@/app/platform/venues/[id]/seating-chart/editor/VisualEditor';

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

export default function AdminVenueEditorPage({
  params,
}: {
  params: { venueId: string };
}) {
  const { venueId } = params;
  const [initialLayout, setInitialLayout] = useState<Layout | null>(null);
  const [chartName, setChartName] = useState('Default');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch(`/api/admin/venues/${venueId}/seating-chart`);
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
    const res = await authFetch(`/api/admin/venues/${venueId}/seating-chart`, {
      method: 'POST',
      body: JSON.stringify({ name, layout }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (res.status === 403) {
        setForbidden(true);
        throw new Error(j.reason ?? 'Forbidden');
      }
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  if (!loaded) {
    return <p className="p-6 text-sm text-muted-foreground">Načítání…</p>;
  }

  if (forbidden) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-xl font-bold">Sdílený sál — editace zakázána</h1>
        <p className="text-sm text-muted-foreground max-w-lg">
          Tento sál je sdíleným katalogem Tixly a může ho editovat pouze platformní správce.
          Pokud potřebujete změnit layout, kontaktujte <strong>support@tixly.cz</strong>.
        </p>
        <p className="text-sm">
          Chcete vlastní editovatelný sál?{' '}
          <Link href="/admin/venues/new" className="text-primary underline">
            Vytvořte si nový soukromý sál →
          </Link>
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-md border border-rose-300 bg-rose-50 text-sm text-rose-900">
        Chyba při načítání: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/admin/venues/${venueId}`} className="text-sm text-primary hover:underline">
            ← Zpět na detail sálu
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Seating editor</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag-and-draw editor pro layout sedadel. Změny se projeví na všech budoucích akcích v tomto sálu.
          </p>
        </div>
      </div>
      <VisualEditor
        initialLayout={initialLayout}
        chartName={chartName}
        onSave={save}
      />
    </div>
  );
}
