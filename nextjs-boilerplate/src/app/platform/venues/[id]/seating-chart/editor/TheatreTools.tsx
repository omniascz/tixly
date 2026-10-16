'use client';

/**
 * Kolo 8 / krok 2 — divadelní nástroje editoru plánku (panel vedle plátna VisualEditoru):
 * generátor sekcí, typ místa, cenové zóny s barvou a legendou, přečíslování výběru, kopie řady, podklad.
 * Logika je v lib/seating/generator.ts (unit testy); tady jen formuláře.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  copyRows,
  generateSection,
  renumberSeats,
  setSeatType,
  setSeatZone,
  type GenSector,
  type SeatType,
} from '@/lib/seating/generator';

export interface Zone { id: string; name: string; color: string }
export interface Underlay { opacity: number; scale: number; x: number; y: number }

const ZONE_COLORS = ['#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
export const SEAT_TYPE_LABEL: Record<SeatType, string> = {
  standard: 'Běžné',
  wheelchair: 'Pro vozíčkáře',
  companion: 'Doprovod vozíčkáře',
  unsellable: 'Neprodejné',
  restricted: 'Omezený výhled',
};

interface Props {
  sectors: GenSector[];
  selected: Set<string>;
  zones: Zone[];
  setZones: (z: Zone[]) => void;
  underlay: Underlay;
  setUnderlay: (u: Underlay) => void;
  hasUnderlay: boolean;
  /** Zapíše novou verzi sekcí (s undo historií). */
  apply: (next: GenSector[]) => void;
  notify: (msg: string) => void;
}

const num = (v: string, d: number) => (v.trim() === '' || Number.isNaN(Number(v)) ? d : Number(v));

export function TheatreTools({ sectors, selected, zones, setZones, underlay, setUnderlay, hasUnderlay, apply, notify }: Props) {
  // generátor
  const [g, setG] = useState({
    name: 'Přízemí', rows: '10', seats: '20', rowLabels: 'number', rowStart: '', rowOrder: 'asc', numbering: 'asc',
    seatStart: '1', aisles: '', gap: '1', offset: '0', x: '60', y: '120', spacing: '30',
  });
  const [note, setNote] = useState('');
  const [zoneName, setZoneName] = useState('');
  const [ren, setRen] = useState({ start: '1', step: '1', rtl: false });
  const [dy, setDy] = useState('30');

  function generate() {
    const name = g.name.trim();
    if (!name) return notify('Zadejte název sekce.');
    if (sectors.some((s) => s.name === name)) return notify(`Sekce „${name}" už existuje — zvolte jiný název.`);
    const sec = generateSection({
      name,
      rows: Math.max(1, num(g.rows, 1)),
      seatsPerRow: Math.max(1, num(g.seats, 1)),
      rowLabels: g.rowLabels as 'number' | 'letter',
      rowStart: g.rowStart.trim() || undefined,
      rowOrder: g.rowOrder as 'asc' | 'desc',
      seatNumbering: g.numbering as 'asc' | 'desc' | 'odd-even',
      seatStart: num(g.seatStart, 1),
      aisleAfter: g.aisles.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0),
      aisleGap: num(g.gap, 1),
      rowOffset: num(g.offset, 0),
      origin: { x: num(g.x, 60), y: num(g.y, 120) },
      spacing: Math.max(10, num(g.spacing, 30)),
    });
    apply([...sectors, { ...sec, color: ZONE_COLORS[sectors.length % ZONE_COLORS.length] }]);
    notify(`Sekce „${name}" vygenerována (${sec.rows.length} × ${sec.rows[0]?.seats.length ?? 0} míst).`);
  }

  function setType(t: SeatType) {
    if (selected.size === 0) return notify('Nejdřív vyberte místa (rámeček nebo Shift+klik).');
    apply(setSeatType(sectors, selected, t, note));
  }

  function addZone() {
    const name = zoneName.trim();
    if (!name) return;
    if (zones.some((z) => z.name === name)) return notify('Zóna s tímto názvem už existuje.');
    const id = `z${Date.now().toString(36)}`;
    setZones([...zones, { id, name, color: ZONE_COLORS[zones.length % ZONE_COLORS.length] }]);
    setZoneName('');
  }

  function assignZone(id: string | null) {
    if (selected.size === 0) return notify('Nejdřív vyberte místa.');
    apply(setSeatZone(sectors, selected, id));
  }

  function removeZone(id: string) {
    setZones(zones.filter((z) => z.id !== id));
    apply(sectors.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r, seats: r.seats.map((x) => (x.zone === id ? { ...x, zone: undefined } : x)) })) })));
  }

  const zoneCount = (id: string) => sectors.reduce((a, s) => a + s.rows.reduce((b, r) => b + r.seats.filter((x) => x.zone === id).length, 0), 0);

  function renumber() {
    if (selected.size === 0) return notify('Nejdřív vyberte místa k přečíslování.');
    apply(renumberSeats(sectors, selected, { start: num(ren.start, 1), step: num(ren.step, 1), rightToLeft: ren.rtl }));
  }

  function copySelectedRows() {
    const bySector = new Map<string, Set<string>>();
    for (const k of selected) {
      const [sec, row] = k.split('|');
      bySector.set(sec, (bySector.get(sec) ?? new Set()).add(row));
    }
    if (bySector.size === 0) return notify('Vyberte aspoň jedno místo v řadě, kterou chcete zkopírovat.');
    let next = sectors;
    for (const [sec, rows] of bySector) next = copyRows(next, sec, [...rows], num(dy, 30));
    apply(next);
  }

  const field = (k: keyof typeof g, label: string, extra?: Partial<React.InputHTMLAttributes<HTMLInputElement>>) => (
    <label className="text-xs">{label}
      <Input className="h-8" value={g[k]} onChange={(e) => setG({ ...g, [k]: e.target.value })} {...extra} />
    </label>
  );
  const select = (k: keyof typeof g, label: string, opts: Array<[string, string]>) => (
    <label className="text-xs">{label}
      <select className="mt-0.5 block h-8 w-full rounded-md border bg-background px-1 text-sm" value={g[k]} onChange={(e) => setG({ ...g, [k]: e.target.value })}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-3" data-testid="theatre-tools">
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Generátor sekce</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          {field('name', 'Sekce (přízemí, balkon, lóže…)', { 'aria-label': 'Název sekce' })}
          {field('rows', 'Počet řad', { type: 'number', 'aria-label': 'Počet řad' })}
          {field('seats', 'Míst v řadě', { type: 'number', 'aria-label': 'Míst v řadě' })}
          {select('rowLabels', 'Řady', [['number', 'čísla'], ['letter', 'písmena']])}
          {field('rowStart', 'První řada (např. 1, A)')}
          {select('rowOrder', 'Pořadí řad', [['asc', 'vzestupně'], ['desc', 'sestupně']])}
          {select('numbering', 'Číslování míst', [['asc', 'zleva vzestupně'], ['desc', 'zleva sestupně'], ['odd-even', 'liché vlevo / sudé vpravo']])}
          {field('seatStart', 'První místo', { type: 'number' })}
          {field('aisles', 'Ulička po místech (např. 5, 15)')}
          {field('gap', 'Šířka uličky (míst)', { type: 'number' })}
          {field('offset', 'Posun každé 2. řady', { type: 'number' })}
          {field('spacing', 'Rozestup', { type: 'number' })}
          {field('x', 'Začátek X', { type: 'number' })}
          {field('y', 'Začátek Y', { type: 'number' })}
          <Button className="col-span-2" size="sm" onClick={generate} data-testid="generate-section">Vygenerovat sekci</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Typ místa (výběr: {selected.size})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(SEAT_TYPE_LABEL) as SeatType[]).map((t) => (
              <Button key={t} size="sm" variant="outline" onClick={() => setType(t)} data-testid={`seat-type-${t}`}>{SEAT_TYPE_LABEL[t]}</Button>
            ))}
          </div>
          <Input className="h-8" placeholder="Poznámka k omezenému výhledu (např. sloup)" value={note} onChange={(e) => setNote(e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Cenové zóny</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-1">
            <Input className="h-8" placeholder="Název zóny (např. Zóna A)" value={zoneName} onChange={(e) => setZoneName(e.target.value)} data-testid="zone-name" />
            <Button size="sm" onClick={addZone} data-testid="zone-add">Přidat</Button>
          </div>
          <ul className="space-y-1" data-testid="zone-legend">
            {zones.map((z) => (
              <li key={z.id} className="flex items-center gap-2 text-sm">
                <input type="color" value={z.color} aria-label={`Barva zóny ${z.name}`}
                  onChange={(e) => setZones(zones.map((x) => (x.id === z.id ? { ...x, color: e.target.value } : x)))} />
                <span className="flex-1">{z.name} <span className="text-xs text-muted-foreground">({zoneCount(z.id)} míst)</span></span>
                <Button size="sm" variant="outline" onClick={() => assignZone(z.id)} data-testid={`zone-assign-${z.name}`}>Přiřadit výběru</Button>
                <Button size="sm" variant="ghost" onClick={() => removeZone(z.id)} aria-label={`Smazat zónu ${z.name}`}>✕</Button>
              </li>
            ))}
          </ul>
          {zones.length > 0 ? <Button size="sm" variant="ghost" onClick={() => assignZone(null)}>Odebrat zónu výběru</Button> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Přečíslovat výběr / kopírovat řadu</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">Od<Input className="h-8" type="number" value={ren.start} onChange={(e) => setRen({ ...ren, start: e.target.value })} /></label>
            <label className="text-xs">Krok<Input className="h-8" type="number" value={ren.step} onChange={(e) => setRen({ ...ren, step: e.target.value })} /></label>
            <label className="flex items-end gap-1 text-xs"><input type="checkbox" checked={ren.rtl} onChange={(e) => setRen({ ...ren, rtl: e.target.checked })} />zprava</label>
          </div>
          <Button size="sm" variant="outline" onClick={renumber}>Přečíslovat výběr</Button>
          <div className="flex items-end gap-2">
            <label className="text-xs">Posun dolů<Input className="h-8 w-20" type="number" value={dy} onChange={(e) => setDy(e.target.value)} /></label>
            <Button size="sm" variant="outline" onClick={copySelectedRows}>Kopírovat řady výběru</Button>
          </div>
        </CardContent>
      </Card>

      {hasUnderlay ? (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Podklad — průhlednost, měřítko, posun</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <label className="col-span-2 text-xs">Průhlednost {Math.round(underlay.opacity * 100)} %
              <input type="range" min={0} max={1} step={0.05} value={underlay.opacity} className="w-full" aria-label="Průhlednost podkladu"
                onChange={(e) => setUnderlay({ ...underlay, opacity: Number(e.target.value) })} />
            </label>
            <label className="col-span-2 text-xs">Měřítko {underlay.scale.toFixed(2)}×
              <input type="range" min={0.2} max={4} step={0.05} value={underlay.scale} className="w-full" aria-label="Měřítko podkladu"
                onChange={(e) => setUnderlay({ ...underlay, scale: Number(e.target.value) })} />
            </label>
            <label className="text-xs">Posun X<Input className="h-8" type="number" value={underlay.x} onChange={(e) => setUnderlay({ ...underlay, x: num(e.target.value, 0) })} /></label>
            <label className="text-xs">Posun Y<Input className="h-8" type="number" value={underlay.y} onChange={(e) => setUnderlay({ ...underlay, y: num(e.target.value, 0) })} /></label>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
