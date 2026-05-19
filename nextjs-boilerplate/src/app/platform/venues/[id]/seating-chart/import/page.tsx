'use client';

import { ChangeEvent, FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Format = 'auto' | 'csv' | 'svg' | 'json' | 'smsticket';

interface DryRunResult {
  dryRun: true;
  format: 'csv' | 'svg' | 'json' | 'smsticket';
  summary: {
    sectors: number;
    rows: number;
    seats: number;
    bySector: { name: string; rows: number; seats: number }[];
  };
  warnings: string[];
  backgroundUrl?: string;
  layoutPreview: {
    viewBox: string;
    sectors: {
      name: string;
      color: string;
      rowCount: number;
      rows: {
        label: string;
        seatCount: number;
        firstNum: string | null;
        lastNum: string | null;
        ellipsis?: boolean;
      }[];
      rowsTruncated: boolean;
    }[];
  };
}

const CSV_TEMPLATE = `sector,row,num,x,y,accessibility
"Tribuna A","A","1",100,200,
"Tribuna A","A","2",130,200,
"Tribuna A","A","3",160,200,true
"Tribuna A","B","1",100,230,
"Tribuna B","A","1",500,200,
`;

const JSON_TEMPLATE = `{
  "viewBox": "0 0 1000 800",
  "sectors": [
    {
      "name": "Tribuna",
      "color": "#3b82f6",
      "rows": [
        { "label": "A", "seats": [
          { "num": "1", "x": 100, "y": 200 },
          { "num": "2", "x": 130, "y": 200 }
        ]}
      ]
    }
  ]
}`;

const SVG_TIPS = `<!-- Z Inkscape / Figma export -->
<!-- Pro nejlepší výsledek přidej data-* atributy: -->
<circle cx="100" cy="200" r="6"
        fill="#3b82f6"
        data-sector="Tribuna A"
        data-row="A"
        data-num="1" />
<!-- Bez metadata se sektory odhadnou podle barvy fill, řady auto-pojmenují A,B,C... -->`;

export default function PlatformSeatingChartImportPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const venueId = params.id;
  const [format, setFormat] = useState<Format>('auto');
  const [name, setName] = useState('Imported');
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sectorRenames, setSectorRenames] = useState<Record<string, string>>({});

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    if (file.size > 20_000_000) {
      setError('Soubor je větší než 20 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result ?? ''));
      setError(null);
    };
    reader.onerror = () => setError('Nepodařilo se načíst soubor');
    reader.readAsText(file);
  }

  async function preview(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDryRun(null);
    try {
      const res = await fetch(`/api/platform/venues/${venueId}/seating-chart/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format, content, name, filename: filename || undefined, dryRun: true,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(j.error ?? `HTTP ${res.status}`));
        return;
      }
      const result = j as unknown as DryRunResult;
      setDryRun(result);
      // For smsticket, seed rename map with detected color hexes so user can fill names.
      if (result.format === 'smsticket') {
        const seed: Record<string, string> = {};
        for (const s of result.layoutPreview.sectors) {
          if (s.name.startsWith('#')) seed[s.name] = '';
        }
        setSectorRenames(seed);
      } else {
        setSectorRenames({});
      }
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!dryRun) return;
    if (!confirm(
      `Importovat ${dryRun.summary.seats} sedadel? Tím se nahradí stávající aktivní seating chart.`,
    )) return;
    setBusy(true);
    setError(null);
    try {
      const renames = Object.fromEntries(
        Object.entries(sectorRenames).filter(([, v]) => v.trim().length > 0),
      );
      const res = await fetch(`/api/platform/venues/${venueId}/seating-chart/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format, content, name, filename: filename || undefined, dryRun: false,
          sectorRenames: Object.keys(renames).length > 0 ? renames : undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/platform/venues/${venueId}/edit`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
          ← Zpět na detail sálu
        </Link>
        <h1 className="mt-1 text-2xl font-bold">📥 Import seating chartu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pro pre-mapped sály (export z venue management software) nebo SVG plánky z Inkscape/Figma.
          Auto-detekce formátu funguje pro typické případy.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1. Vstup</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={preview} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Formát</label>
                <div className="flex flex-wrap gap-2">
                  {(['auto', 'csv', 'svg', 'json', 'smsticket'] as Format[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={
                        format === f
                          ? 'rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground'
                          : 'rounded-md border bg-background px-3 py-1 text-sm hover:bg-accent'
                      }
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Název chartu</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Nahrát soubor (.csv / .svg / .json, max 20 MB)
                </label>
                <input
                  type="file"
                  accept=".csv,.svg,.json,text/csv,image/svg+xml,application/json"
                  onChange={onFile}
                  className="block w-full text-sm"
                />
                {filename && (
                  <p className="mt-1 text-xs text-muted-foreground">📎 {filename}</p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  …nebo paste obsah
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={12}
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                  placeholder="Paste CSV / SVG / JSON…"
                />
              </div>

              <Button type="submit" disabled={busy || !content}>
                {busy ? 'Parsuji…' : '🔍 Náhled (dry run)'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Náhled</CardTitle>
          </CardHeader>
          <CardContent>
            {!dryRun ? (
              <div className="space-y-4 text-sm text-muted-foreground">
                <p>
                  Po kliknutí na <strong>Náhled</strong> uvidíš počet sektorů, řad a sedadel, plus
                  warnings z parseru.
                </p>
                <details>
                  <summary className="cursor-pointer">📋 CSV šablona</summary>
                  <pre className="mt-2 rounded bg-muted p-2 text-[10px]">{CSV_TEMPLATE}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer">📋 JSON šablona</summary>
                  <pre className="mt-2 rounded bg-muted p-2 text-[10px]">{JSON_TEMPLATE}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer">📋 SVG tips</summary>
                  <pre className="mt-2 rounded bg-muted p-2 text-[10px]">{SVG_TIPS}</pre>
                </details>
                <details>
                  <summary className="cursor-pointer">🎟 SmsTicket import</summary>
                  <p className="mt-2 text-[11px] leading-relaxed">
                    Otevři mapu sálu na smsticket.cz (přihlášený), v DevTools (F12) najdi{' '}
                    <code>&lt;svg&gt;</code> mapy → Edit as HTML → Copy outerHTML → vlož sem.
                    Parser detekuje jVectorMap formát automaticky, naparsuje sedadla, číselné štítky a
                    pozadí (floor plan). Sektory se rozeznají podle barev a pojmenuješ je v náhledu.
                  </p>
                </details>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
                  ✓ Naparsováno z formátu <code className="rounded bg-white px-1">{dryRun.format}</code>
                  {dryRun.format === 'smsticket' && (
                    <span className="ml-2 text-xs text-emerald-800">
                      (jVectorMap mapa — sektory jsou rozeznané podle barev, pojmenuj je níže)
                    </span>
                  )}
                </div>
                {dryRun.backgroundUrl && (
                  <div className="rounded-md border bg-card p-2 text-xs text-muted-foreground">
                    📎 Floor plan detekován — uloží se jako <code className="rounded bg-muted px-1">venue.floor_plan_url</code>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Sektorů" value={dryRun.summary.sectors} />
                  <Stat label="Řad" value={dryRun.summary.rows} />
                  <Stat label="Sedadel" value={dryRun.summary.seats} highlight />
                </div>

                {dryRun.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    <div className="font-medium">⚠ Warnings ({dryRun.warnings.length})</div>
                    <ul className="ml-4 list-disc">
                      {dryRun.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                      {dryRun.warnings.length > 5 && <li>…a {dryRun.warnings.length - 5} dalších</li>}
                    </ul>
                  </div>
                )}

                <div>
                  <div className="mb-1 text-xs uppercase text-muted-foreground">
                    Sektory{dryRun.format === 'smsticket' && ' — pojmenuj zóny'}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-1">Detekováno</th>
                        <th>Barva</th>
                        {dryRun.format === 'smsticket' && <th>Lidské jméno</th>}
                        <th className="text-right">Řad</th>
                        <th className="text-right">Seats</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dryRun.layoutPreview.sectors.map((s, i) => {
                        const total = dryRun.summary.bySector.find((x) => x.name === s.name)?.seats ?? 0;
                        return (
                          <tr key={i} className="border-b">
                            <td className="py-1 font-mono">{s.name}</td>
                            <td>
                              <span
                                className="inline-block h-3 w-6 rounded"
                                style={{ background: s.color }}
                              />
                            </td>
                            {dryRun.format === 'smsticket' && (
                              <td>
                                <input
                                  value={sectorRenames[s.name] ?? ''}
                                  onChange={(e) =>
                                    setSectorRenames((prev) => ({ ...prev, [s.name]: e.target.value }))
                                  }
                                  placeholder="např. Přízemí - Zóna I"
                                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                                />
                              </td>
                            )}
                            <td className="text-right">{s.rowCount}</td>
                            <td className="text-right tabular-nums">{total}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {dryRun.format === 'smsticket' && (
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Tip: barvy v smsticket odpovídají cenovým zónám. Nech prázdné a uloží se hex
                      (přejmenovat lze i potom v editoru).
                    </p>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-xs uppercase text-muted-foreground">
                    Řady a čísla sedadel
                  </div>
                  <div className="space-y-2">
                    {dryRun.layoutPreview.sectors.map((s, i) => (
                      <details key={i} className="rounded-md border bg-card text-xs">
                        <summary className="cursor-pointer px-2 py-1.5 hover:bg-muted/50">
                          <span
                            className="mr-2 inline-block h-2 w-4 rounded align-middle"
                            style={{ background: s.color }}
                          />
                          <strong>{sectorRenames[s.name] || s.name}</strong>
                          {' · '}
                          {s.rowCount} řad
                          {' · '}
                          {(dryRun.summary.bySector.find((x) => x.name === s.name)?.seats ?? 0)} seats
                        </summary>
                        <table className="w-full border-t text-[11px]">
                          <thead>
                            <tr className="border-b bg-muted/30 text-left">
                              <th className="px-2 py-1">Řada</th>
                              <th className="text-right">Sedadel</th>
                              <th className="px-2">Čísla</th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.rows.map((r, j) => r.ellipsis ? (
                              <tr key={j}><td colSpan={3} className="py-1 text-center text-muted-foreground">… ({s.rowCount - 5} dalších řad …)</td></tr>
                            ) : (
                              <tr key={j} className="border-b last:border-b-0">
                                <td className="px-2 py-1 font-mono">{r.label}</td>
                                <td className="text-right">{r.seatCount}</td>
                                <td className="px-2 font-mono">
                                  {r.firstNum && r.lastNum
                                    ? r.firstNum === r.lastNum
                                      ? r.firstNum
                                      : `${r.firstNum}–${r.lastNum}`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Sloupec <strong>Čísla</strong> = rozsah čísel sedadel v řadě (např. <code>1–22</code>). Pokud to
                    nesedí, zkontroluj zdrojová data — pak teprve commitni.
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button onClick={commit} disabled={busy}>
                    {busy ? 'Importuji…' : '✓ Importovat a nahradit aktivní chart'}
                  </Button>
                  <Button variant="outline" onClick={() => setDryRun(null)} disabled={busy}>
                    Zpět k editaci
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-2 ${highlight ? 'bg-emerald-50' : 'bg-card'}`}>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value.toLocaleString('cs-CZ')}</div>
    </div>
  );
}
