'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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

// ── Builder model: sektor = skupiny řad „řady FROM–TO mají SEATS sedadel" ──────
interface RowGroup {
  from: number;
  to: number;
  seats: number;
  aisleAfter?: number; // ulička po N-tém sedadle (volitelné)
  accCount?: number;   // první N sedadel v každé řadě = bezbariérové (♿)
}
interface BuilderSector {
  name: string;
  color: string;
  groups: RowGroup[];
  rowLabelFormat?: 'number' | 'letter'; // číslování řad: 1,2,3 nebo A,B,C (default = number)
}
type StagePos = 'top' | 'bottom' | 'none';

const PALETTE = ['#d83a2e', '#e8821e', '#3b82f6', '#8b5cf6', '#06b6d4', '#84cc16'];
const SEAT_DX = 30;
const SEAT_DY = 32;
const AISLE = 42;
const SECTOR_GAP = 80;
const CENTER = 700;

function sectorSeatCount(s: BuilderSector): number {
  return s.groups.reduce((a, g) => a + Math.max(0, g.to - g.from + 1) * g.seats, 0);
}

interface GenSeat { num: string; x: number; y: number; acc?: boolean }
interface GenRow { label: string; seats: GenSeat[] }
interface GenSector { name: string; color: string; rows: GenRow[] }
interface GenLayout {
  viewBox: string;
  stage?: { position: 'top' | 'bottom'; label: string };
  sectors: GenSector[];
  builder: { stage: StagePos; sectors: BuilderSector[] };
}

function rowNumToLabel(n: number, format?: 'number' | 'letter'): string {
  if (format !== 'letter') return String(n);
  // Excel-style: 1=A, 26=Z, 27=AA, ...
  let result = '';
  let remaining = n;
  while (remaining > 0) {
    const rem = (remaining - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result;
}

function rowSeats(count: number, x0: number, y: number, start = 1, accLimit = 0): GenSeat[] {
  return Array.from({ length: count }, (_, i) => {
    const s: GenSeat = { x: x0 + i * SEAT_DX, y, num: String(start + i) };
    if (accLimit > 0 && i < accLimit) s.acc = true;
    return s;
  });
}

function generateLayout(stage: StagePos, sectors: BuilderSector[], stageLabel: string): GenLayout {
  const STAGE_H = stage === 'none' ? 0 : 70;
  let y = (stage === 'top' ? STAGE_H + 30 : 0) + 60;
  const genSectors: GenSector[] = [];

  for (const sec of sectors) {
    const rows: GenRow[] = [];
    // seřaď skupiny podle čísla řady
    const groups = [...sec.groups].sort((a, b) => a.from - b.from);
    for (const g of groups) {
      for (let rn = g.from; rn <= g.to; rn++) {
        const n = g.seats;
        const aisle = g.aisleAfter && g.aisleAfter > 0 && g.aisleAfter < n ? g.aisleAfter : 0;
        const accLimit = g.accCount && g.accCount > 0 ? Math.min(g.accCount, n) : 0;
        let seats: GenSeat[];
        if (aisle) {
          const right = n - aisle;
          const totalW = (n - 2) * SEAT_DX + AISLE;
          const x0 = CENTER - totalW / 2;
          const rightX0 = x0 + (aisle - 1) * SEAT_DX + AISLE;
          const leftAcc = Math.min(accLimit, aisle);
          const rightAcc = Math.max(0, accLimit - aisle);
          seats = [...rowSeats(aisle, x0, y, 1, leftAcc), ...rowSeats(right, rightX0, y, aisle + 1, rightAcc)];
        } else {
          const x0 = CENTER - ((n - 1) * SEAT_DX) / 2;
          seats = rowSeats(n, x0, y, 1, accLimit);
        }
        const rowLabel = rowNumToLabel(rn, sec.rowLabelFormat);
        rows.push({ label: rowLabel, seats });
        y += SEAT_DY;
      }
    }
    genSectors.push({ name: sec.name, color: sec.color, rows });
    y += SECTOR_GAP;
  }

  const all = genSectors.flatMap((s) => s.rows.flatMap((r) => r.seats));
  const xs = all.map((s) => s.x);
  const ys = all.map((s) => s.y);
  const minX = (xs.length ? Math.min(...xs) : 0) - 60;
  const maxX = (xs.length ? Math.max(...xs) : 1000) + 60;
  const minY = stage === 'top' ? 20 : (ys.length ? Math.min(...ys) : 0) - 40;
  const maxY = (ys.length ? Math.max(...ys) : 800) + (stage === 'bottom' ? STAGE_H + 30 : 40);
  const viewBox = `${Math.round(minX)} ${Math.round(minY)} ${Math.round(maxX - minX)} ${Math.round(maxY - minY)}`;

  return {
    viewBox,
    ...(stage !== 'none' ? { stage: { position: stage, label: stageLabel } } : {}),
    sectors: genSectors,
    builder: { stage, sectors },
  };
}

export default function PlatformSeatingChartPage({ params }: { params: { id: string } }) {
  const venueId = params.id;

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hadNonBuilderChart, setHadNonBuilderChart] = useState(false);

  const [chartName, setChartName] = useState('Hlediště');
  const [stage, setStage] = useState<StagePos>('top');
  const [stageLabel, setStageLabel] = useState('PODIUM');
  const [sectors, setSectors] = useState<BuilderSector[]>([
    { name: 'Přízemí', color: PALETTE[0], groups: [{ from: 1, to: 10, seats: 16 }] },
  ]);

  useEffect(() => {
    void (async () => {
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart`);
      if (res.ok) {
        const j = (await res.json()) as {
          chart?: {
            name?: string;
            layout?: { builder?: { stage: StagePos; sectors: BuilderSector[] }; stage?: { label: string } };
          };
        };
        const layout = j.chart?.layout;
        if (layout?.builder) {
          // znovu-otevření builderem vytvořeného sálu → obnov zadání
          setStage(layout.builder.stage);
          setSectors(layout.builder.sectors);
          if (layout.stage?.label) setStageLabel(layout.stage.label);
          if (j.chart?.name) setChartName(j.chart.name);
        } else if (j.chart) {
          // sál vytvořený jiným nástrojem (visual editor / import) — builder ho přepíše
          setHadNonBuilderChart(true);
          if (j.chart.name) setChartName(j.chart.name);
        }
      }
      setLoading(false);
    })();
  }, [venueId]);

  function setSector(i: number, patch: Partial<BuilderSector>) {
    setSectors((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addSector() {
    setSectors((prev) => [
      ...prev,
      { name: prev.length === 0 ? 'Přízemí' : 'Balkon', color: PALETTE[prev.length % PALETTE.length], groups: [{ from: 1, to: 6, seats: 14 }] },
    ]);
  }
  function removeSector(i: number) {
    setSectors((prev) => prev.filter((_, idx) => idx !== i));
  }
  function setGroup(si: number, gi: number, patch: Partial<RowGroup>) {
    setSectors((prev) =>
      prev.map((s, idx) =>
        idx === si ? { ...s, groups: s.groups.map((g, j) => (j === gi ? { ...g, ...patch } : g)) } : s,
      ),
    );
  }
  function addGroup(si: number) {
    setSectors((prev) =>
      prev.map((s, idx) => {
        if (idx !== si) return s;
        const lastTo = s.groups.reduce((m, g) => Math.max(m, g.to), 0);
        return { ...s, groups: [...s.groups, { from: lastTo + 1, to: lastTo + 3, seats: s.groups.at(-1)?.seats ?? 14 }] };
      }),
    );
  }
  function removeGroup(si: number, gi: number) {
    setSectors((prev) =>
      prev.map((s, idx) => (idx === si ? { ...s, groups: s.groups.filter((_, j) => j !== gi) } : s)),
    );
  }
  function duplicateSector(i: number) {
    setSectors((prev) => {
      const src = prev[i];
      const copy: BuilderSector = {
        ...src,
        name: src.name + ' (kopie)',
        color: PALETTE[prev.length % PALETTE.length],
        groups: src.groups.map((g) => ({ ...g })),
      };
      const next = [...prev];
      next.splice(i + 1, 0, copy);
      return next;
    });
  }

  const [importing, setImporting] = useState(false);
  async function importFromImage(file: File) {
    setError(null);
    setFeedback(null);
    setImporting(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('Nepodařilo se načíst soubor.'));
        fr.readAsDataURL(file);
      });
      const m = dataUrl.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/);
      if (!m) {
        setError('Podporované jsou PNG, JPEG, WEBP nebo GIF.');
        return;
      }
      const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart/from-image`, {
        method: 'POST',
        body: JSON.stringify({ imageBase64: m[3], mediaType: m[1] }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        builder?: { stage: StagePos; sectors: { name: string; groups: RowGroup[] }[] };
        totalSeats?: number;
        message?: string;
        error?: string;
      };
      if (!res.ok || !j.builder) {
        setError(j.message ?? j.error ?? `Načtení z obrázku selhalo (HTTP ${res.status}).`);
        return;
      }
      setStage(j.builder.stage);
      setSectors(
        j.builder.sectors.map((s, i) => ({ name: s.name, color: PALETTE[i % PALETTE.length], groups: s.groups })),
      );
      setFeedback(`Načteno z obrázku: ${j.totalSeats} sedadel. Zkontroluj náhled a případně dolaď, pak ulož.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Načtení z obrázku selhalo.');
    } finally {
      setImporting(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    // validace: souvislé, neprázdné
    for (const s of sectors) {
      if (!s.name.trim()) return setError('Každý sektor musí mít název.');
      for (const g of s.groups) {
        if (g.to < g.from) return setError(`Sektor „${s.name}": řada OD nesmí být větší než DO.`);
        if (g.seats < 1) return setError(`Sektor „${s.name}": počet sedadel musí být ≥ 1.`);
      }
    }
    const layout = generateLayout(stage, sectors, stageLabel);
    const res = await authFetch(`/api/platform/venues/${venueId}/seating-chart`, {
      method: 'POST',
      body: JSON.stringify({ name: chartName, layout }),
    });
    const j = (await res.json().catch(() => ({}))) as { totalSeats?: number; error?: string };
    if (!res.ok) return setError(j.error ?? `Uložení selhalo (HTTP ${res.status}).`);
    setHadNonBuilderChart(false);
    setFeedback(`✓ Uloženo — sál má ${j.totalSeats} sedadel a je připravený k použití.`);
  }

  const preview = generateLayout(stage, sectors, stageLabel);
  const total = sectors.reduce((a, s) => a + sectorSeatCount(s), 0);
  const stageBarY = stage === 'top'
    ? Number(preview.viewBox.split(' ')[1]) + 10
    : Number(preview.viewBox.split(' ')[1]) + Number(preview.viewBox.split(' ')[3]) - 70;

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/platform/venues/${venueId}/edit`} className="text-sm text-primary hover:underline">
            ← Zpět na detail sálu
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Plán sálu</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Postav plán ve 3 krocích: <b>1)</b> kde je jeviště · <b>2)</b> přidej sektory (Přízemí, Balkon…) ·
            <b> 3)</b> v každém sektoru řekni „řady X–Y mají Z sedadel". Náhled vpravo se hned aktualizuje.
            Souřadnice ani rozteče řešit nemusíš.
          </p>
        </div>
        <Link href={`/platform/venues/${venueId}/seating-chart/editor`}>
          <Button variant="outline" size="sm">Pokročilý vizuální editor →</Button>
        </Link>
      </div>

      {hadNonBuilderChart ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠️ Tento sál byl vytvořen pokročilým editorem/importem. Když ho uložíš tady, jednoduchý plán ho přepíše.
        </div>
      ) : null}
      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {feedback ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div> : null}

      <form onSubmit={save} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── LEVÝ sloupec: zadání ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">1 · Základ</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Název plánu</label>
                <Input value={chartName} onChange={(e) => setChartName(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Jeviště / pódium</label>
                <div className="flex gap-2">
                  {([['top', 'Nahoře'], ['bottom', 'Dole'], ['none', 'Bez jeviště']] as [StagePos, string][]).map(([v, lbl]) => (
                    <button key={v} type="button" onClick={() => setStage(v)}
                      className={stage === v ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground' : 'rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted'}>
                      {lbl}
                    </button>
                  ))}
                </div>
                {stage !== 'none' ? (
                  <Input className="mt-2 max-w-xs" value={stageLabel} onChange={(e) => setStageLabel(e.target.value)} placeholder="Popisek (PODIUM)" />
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">2 · Sektory a řady</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3 text-sm font-medium text-primary hover:bg-primary/10">
                📷 {importing ? 'Čtu obrázek mapy…' : 'Načíst z obrázku mapy (rychlé) — nebo zadej ručně níže'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  disabled={importing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFromImage(f);
                    e.target.value = '';
                  }}
                />
              </label>
              {sectors.map((s, si) => (
                <div key={si} className="rounded-lg border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <input type="color" value={s.color} onChange={(e) => setSector(si, { color: e.target.value })} className="h-7 w-9 rounded border" aria-label="Barva sektoru" />
                    <Input value={s.name} onChange={(e) => setSector(si, { name: e.target.value })} className="max-w-[160px]" placeholder="Název sektoru" />
                    <div className="flex gap-1" title="Formát číslování řad">
                      {(['number', 'letter'] as const).map((fmt) => (
                        <button key={fmt} type="button"
                          onClick={() => setSector(si, { rowLabelFormat: fmt })}
                          className={(s.rowLabelFormat ?? 'number') === fmt
                            ? 'rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground'
                            : 'rounded border bg-background px-2 py-0.5 text-xs hover:bg-muted'}
                          title={fmt === 'number' ? 'Číslovat řady: 1, 2, 3…' : 'Označovat řady: A, B, C…'}
                        >{fmt === 'number' ? '1,2,3' : 'A,B,C'}</button>
                      ))}
                    </div>
                    <span className="ml-auto text-xs text-muted-foreground">{sectorSeatCount(s)} sedadel</span>
                    <button type="button" onClick={() => duplicateSector(si)} className="text-xs text-primary hover:underline">duplikovat</button>
                    {sectors.length > 1 ? (
                      <button type="button" onClick={() => removeSector(si)} className="text-xs text-rose-700 hover:underline">smazat</button>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    {s.groups.map((g, gi) => (
                      <div key={gi} className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/30 p-2 text-sm">
                        <span>Řady</span>
                        <Input type="number" min={1} value={g.from} onChange={(e) => setGroup(si, gi, { from: Number(e.target.value) })} className="w-16" />
                        <span>–</span>
                        <Input type="number" min={1} value={g.to} onChange={(e) => setGroup(si, gi, { to: Number(e.target.value) })} className="w-16" />
                        {s.rowLabelFormat === 'letter' ? (
                          <span className="text-xs text-primary" title="Ekvivalent v písmenech">
                            ({rowNumToLabel(g.from, 'letter')}–{rowNumToLabel(g.to, 'letter')})
                          </span>
                        ) : null}
                        <span>mají</span>
                        <Input type="number" min={1} value={g.seats} onChange={(e) => setGroup(si, gi, { seats: Number(e.target.value) })} className="w-16" />
                        <span>sedadel</span>
                        <span className="ml-1 text-muted-foreground" title="Ulička: sedadla se rozdělí na dva bloky">· ulička po</span>
                        <Input type="number" min={0} value={g.aisleAfter ?? 0} onChange={(e) => setGroup(si, gi, { aisleAfter: Number(e.target.value) || undefined })} className="w-14" title="0 = bez uličky" />
                        <span className="ml-1 text-muted-foreground" title="Počet bezbariérových sedadel od začátku každé řady">· ♿</span>
                        <Input type="number" min={0} value={g.accCount ?? 0} onChange={(e) => setGroup(si, gi, { accCount: Number(e.target.value) || undefined })} className="w-12" title="Bezbariérová sedadla od začátku řady (0 = žádné)" />
                        {s.groups.length > 1 ? (
                          <button type="button" onClick={() => removeGroup(si, gi)} className="ml-auto text-xs text-rose-700 hover:underline">×</button>
                        ) : null}
                      </div>
                    ))}
                    <button type="button" onClick={() => addGroup(si)} className="text-xs text-primary hover:underline">+ přidat skupinu řad</button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addSector}>+ Přidat sektor</Button>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button type="submit" size="lg">Uložit plán sálu</Button>
            <span className="text-sm text-muted-foreground">Celkem <b>{total}</b> sedadel</span>
          </div>
        </div>

        {/* ── PRAVÝ sloupec: živý náhled ── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle className="text-base">3 · Náhled ({total} sedadel)</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-auto rounded bg-white p-2" style={{ maxHeight: 600 }}>
                <svg viewBox={preview.viewBox} className="block w-full" style={{ minHeight: 300 }}>
                  {preview.stage ? (
                    <g>
                      <rect x={CENTER - 170} y={stageBarY} width={340} height={46} rx={8} fill="#d9d9d9" />
                      <text x={CENTER} y={stageBarY + 29} textAnchor="middle" fontSize={16} fill="#444">{stageLabel}</text>
                    </g>
                  ) : null}
                  {preview.sectors.map((sector) => (
                    <g key={sector.name}>
                      {sector.rows.map((row) => {
                        const firstSeat = row.seats[0];
                        return (
                          <g key={row.label}>
                            {firstSeat ? (
                              <text
                                x={firstSeat.x - 18}
                                y={firstSeat.y}
                                fontSize={8}
                                fill="#94a3b8"
                                textAnchor="middle"
                                dominantBaseline="middle"
                              >
                                {row.label}
                              </text>
                            ) : null}
                            {row.seats.map((seat) => (
                              <circle
                                key={`${sector.name}-${row.label}-${seat.num}`}
                                cx={seat.x}
                                cy={seat.y}
                                r={9}
                                fill={seat.acc ? '#bbf7d0' : 'none'}
                                stroke={seat.acc ? '#16a34a' : sector.color}
                                strokeWidth={seat.acc ? 2.5 : 2}
                              />
                            ))}
                          </g>
                        );
                      })}
                      {sector.rows[0] ? (
                        <text x={sector.rows[0].seats[0]?.x ?? CENTER} y={(sector.rows[0].seats[0]?.y ?? 0) - 18}
                          fontSize={14} fontWeight={600} fill={sector.color}>{sector.name}</text>
                      ) : null}
                    </g>
                  ))}
                </svg>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Náhled je orientační. Po uložení se zobrazí v detailu sálu a v editoru akcí.
              </p>
            </CardContent>
          </Card>
        </div>
      </form>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <Link href={`/platform/venues/${venueId}/seating-chart/import`} className="hover:underline">Import CSV/SVG/JSON</Link>
        <Link href={`/platform/venues/${venueId}/seating-chart/versions`} className="hover:underline">Historie verzí</Link>
        <Link href={`/platform/venues/${venueId}/seating-chart/editor`} className="hover:underline">Pokročilý vizuální editor</Link>
        <Link href={`/platform/venues/${venueId}/seating-chart/view-photos`} className="font-medium text-amber-600 hover:underline">📷 Pohled ze sedadla — fotky</Link>
      </div>
    </div>
  );
}
