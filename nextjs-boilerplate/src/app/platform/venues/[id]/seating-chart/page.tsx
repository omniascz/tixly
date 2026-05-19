'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface SectorSpec {
  name: string;
  rows: number;
  seatsPerRow: number;
  startX: number;
  startY: number;
  spacingX: number;
  spacingY: number;
  color: string;
}

const PALETTE = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16'];

function generateLayout(sectors: SectorSpec[]): {
  viewBox: string;
  sectors: {
    name: string;
    color: string;
    rows: { label: string; seats: { num: string; x: number; y: number }[] }[];
  }[];
} {
  let maxX = 0;
  let maxY = 0;
  const out = sectors.map((s) => {
    const rows = [];
    for (let r = 0; r < s.rows; r++) {
      const rowLabel = String.fromCharCode(65 + r);
      const seats = [];
      for (let n = 0; n < s.seatsPerRow; n++) {
        const x = s.startX + n * s.spacingX;
        const y = s.startY + r * s.spacingY;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        seats.push({ num: String(n + 1), x, y });
      }
      rows.push({ label: rowLabel, seats });
    }
    return { name: s.name, color: s.color, rows };
  });
  return {
    viewBox: `0 0 ${Math.ceil(maxX + 50)} ${Math.ceil(maxY + 50)}`,
    sectors: out,
  };
}

export default function PlatformSeatingChartPage({
  params,
}: {
  params: { id: string };
}) {
  const venueId = params.id;
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [chartName, setChartName] = useState('Default');
  const [sectors, setSectors] = useState<SectorSpec[]>([
    { name: 'Sektor A', rows: 10, seatsPerRow: 20, startX: 50, startY: 50, spacingX: 22, spacingY: 22, color: PALETTE[0] },
  ]);

  const [jsonInput, setJsonInput] = useState('');
  const [tab, setTab] = useState<'builder' | 'json'>('builder');

  useEffect(() => {
    void load();
    async function load() {
      const res = await fetch(`/api/platform/venues/${venueId}/seating-chart`);
      if (res.ok) {
        const j = (await res.json()) as { chart: unknown };
        // Pokud sál už má chart, redirect na detail — grid builder je jen pro prázdný stav.
        if (j.chart) {
          router.replace(`/platform/venues/${venueId}/edit`);
        }
      }
    }
  }, [venueId]);

  function addSector() {
    setSectors([
      ...sectors,
      {
        name: `Sektor ${String.fromCharCode(65 + sectors.length)}`,
        rows: 10,
        seatsPerRow: 20,
        startX: 50,
        startY: 50 + sectors.length * 250,
        spacingX: 22,
        spacingY: 22,
        color: PALETTE[sectors.length % PALETTE.length],
      },
    ]);
  }

  function updateSector(i: number, patch: Partial<SectorSpec>) {
    setSectors(sectors.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function removeSector(i: number) {
    setSectors(sectors.filter((_, idx) => idx !== i));
  }

  async function publish(layout: unknown) {
    setError(null);
    setFeedback(null);
    const res = await fetch(`/api/platform/venues/${venueId}/seating-chart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: chartName, layout }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; totalSeats?: number; error?: string };
    if (!res.ok) {
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setFeedback(`Uloženo: ${j.totalSeats} sedadel. Přesměrování na detail sálu…`);
    // Po úspěšném save redirect na detail — odtud uživatel pokračuje (visual editor / sector tools).
    setTimeout(() => router.replace(`/platform/venues/${venueId}/edit`), 800);
  }

  async function publishBuilder(e: FormEvent) {
    e.preventDefault();
    await publish(generateLayout(sectors));
  }

  async function publishJson(e: FormEvent) {
    e.preventDefault();
    try {
      await publish(JSON.parse(jsonInput));
    } catch (err) {
      setError(`Neplatný JSON: ${(err as Error).message}`);
    }
  }

  const previewLayout = generateLayout(sectors);
  const totalSeats = sectors.reduce((acc, s) => acc + s.rows * s.seatsPerRow, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
            ← Zpět na detail sálu
          </Link>
          <h1 className="mt-1 text-2xl font-bold">🪑 Seating chart — grid builder</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Vygeneruj layout přes grid (rovnoměrné sektory), nebo paste JSON. Pro nepravidelné sály
            použij <Link href={`/platform/venues/${venueId}/seating-chart/editor`} className="underline">visual editor</Link>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/platform/venues/${venueId}/seating-chart/versions`}>
            <Button variant="outline">📜 Historie verzí</Button>
          </Link>
          <Link href={`/platform/venues/${venueId}/seating-chart/import`}>
            <Button variant="outline">📥 Import CSV/SVG/JSON</Button>
          </Link>
          <Link href={`/platform/venues/${venueId}/seating-chart/editor`}>
            <Button>🎨 Visual editor →</Button>
          </Link>
        </div>
      </div>

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

      {/* Pokud sál již má chart, redirectneme dřív (useEffect výše) — tahle stránka je jen pro empty-state. */}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab('builder')}
          className={
            tab === 'builder'
              ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
              : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
          }
        >
          Grid builder
        </button>
        <button
          type="button"
          onClick={() => setTab('json')}
          className={
            tab === 'json'
              ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
              : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
          }
        >
          JSON paste
        </button>
      </div>

      {tab === 'builder' ? (
        <Card>
          <CardHeader>
            <CardTitle>Grid builder</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={publishBuilder} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Název layoutu</label>
                <Input value={chartName} onChange={(e) => setChartName(e.target.value)} required />
              </div>

              <div className="space-y-3">
                {sectors.map((s, i) => (
                  <div key={i} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={s.color}
                          onChange={(e) => updateSector(i, { color: e.target.value })}
                          className="h-6 w-8 rounded border"
                        />
                        <Input
                          value={s.name}
                          onChange={(e) => updateSector(i, { name: e.target.value })}
                          className="max-w-xs"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSector(i)}
                        className="text-xs text-rose-700 hover:underline"
                      >
                        Smazat
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs">Řad (A-Z)</label>
                        <Input type="number" min={1} max={26} value={s.rows}
                          onChange={(e) => updateSector(i, { rows: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs">Sedadel v řadě</label>
                        <Input type="number" min={1} max={100} value={s.seatsPerRow}
                          onChange={(e) => updateSector(i, { seatsPerRow: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs">Start X</label>
                        <Input type="number" value={s.startX}
                          onChange={(e) => updateSector(i, { startX: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs">Start Y</label>
                        <Input type="number" value={s.startY}
                          onChange={(e) => updateSector(i, { startY: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs">Spacing X</label>
                        <Input type="number" min={5} value={s.spacingX}
                          onChange={(e) => updateSector(i, { spacingX: Number(e.target.value) })} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs">Spacing Y</label>
                        <Input type="number" min={5} value={s.spacingY}
                          onChange={(e) => updateSector(i, { spacingY: Number(e.target.value) })} />
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      = {s.rows * s.seatsPerRow} sedadel
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addSector}>
                  + Přidat sektor
                </Button>
              </div>

              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  Náhled ({totalSeats} sedadel)
                </div>
                <div className="overflow-auto rounded bg-white p-2">
                  <svg
                    viewBox={previewLayout.viewBox}
                    className="block w-full"
                    style={{ minHeight: 200, maxHeight: 500 }}
                  >
                    {previewLayout.sectors.map((sector) => (
                      <g key={sector.name}>
                        {sector.rows.map((row) =>
                          row.seats.map((seat) => (
                            <circle
                              key={`${sector.name}-${row.label}-${seat.num}`}
                              cx={seat.x}
                              cy={seat.y}
                              r={6}
                              fill={sector.color}
                            />
                          )),
                        )}
                      </g>
                    ))}
                  </svg>
                </div>
              </div>

              <Button type="submit">Uložit layout</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>JSON paste</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={publishJson} className="space-y-3">
              <Input value={chartName} onChange={(e) => setChartName(e.target.value)} placeholder="Název layoutu" />
              <textarea
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                rows={20}
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                placeholder={`{
  "viewBox": "0 0 1000 800",
  "sectors": [
    {
      "name": "Tribuna",
      "color": "#3b82f6",
      "rows": [{ "label": "A", "seats": [{ "num": "1", "x": 100, "y": 200 }] }]
    }
  ]
}`}
              />
              <Button type="submit">Uložit JSON</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
