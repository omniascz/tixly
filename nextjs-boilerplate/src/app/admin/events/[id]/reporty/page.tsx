'use client';

/**
 * Kolo 8 / krok 8 — reporty termínu (+ celé inscenace a období): prodáno a tržby podle zóny, kategorie a kanálu,
 * obsazenost, blokace, rezervace; export CSV / XLSX; seznam pro uvaděče (PDF k tisku, CSV).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Sales { eventId: string; title: string; dateStart: string; zone: string; category: string; channel: string; sold: number; revenueMinor: number }
interface Occ { eventId: string; title: string; dateStart: string; city: string | null; hall: string | null; sellable: number; sold: number; reserved: number; blocked: number; occupiedPct: number }
interface Blk { eventId: string; title: string; block: string; total: number; released: number; issued: number; sold: number; remaining: number }
interface Res { eventId: string; title: string; active: number; paid: number; expired: number; cancelled: number; expiredSeats: number }
interface Report { productionId?: string | null; events: number; sales: Sales[]; occupancy: Occ[]; blocks: Blk[]; reservations: Res[]; totals: { sold: number; revenueMinor: number } }

const token = () => (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null);
const api = (url: string) => fetch(url, { credentials: 'include', headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
const kc = (m: number) => `${(m / 100).toLocaleString('cs-CZ')} Kč`;
const CH: Record<string, string> = { online: 'online', box_office: 'pokladna', reservation: 'rezervace', corporate: 'firemní', comps: 'volné' };

async function download(url: string, name: string): Promise<string | null> {
  const r = await api(url).catch(() => null);
  if (!r || !r.ok) return `Soubor se nepodařilo stáhnout${r ? ` (HTTP ${r.status})` : ''}.`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  return null;
}

export default function TermReportsPage({ params }: { params: { id: string } }) {
  const [query, setQuery] = useState(`scope=term&eventId=${params.id}`);
  const [rep, setRep] = useState<Report | null>(null);
  const [productionId, setProductionId] = useState<string | null>(null);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    void api(`/api/admin/theatre-reports?${query}`).then(async (r) => {
      if (!r.ok) { setErr(`Report se nepodařilo načíst (HTTP ${r.status}).`); return; }
      const j = (await r.json()) as Report;
      setRep(j);
      if (j.productionId) setProductionId(j.productionId);
    });
  }, [query]);

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-xl font-semibold">Reporty</h1>
      <div className="flex flex-wrap items-end gap-2">
        <Button variant={query.startsWith('scope=term') ? 'default' : 'outline'} onClick={() => setQuery(`scope=term&eventId=${params.id}`)}>Tento termín</Button>
        {productionId && <Button variant={query.startsWith('scope=production') ? 'default' : 'outline'} onClick={() => setQuery(`scope=production&productionId=${productionId}`)}>Celá inscenace</Button>}
        <label className="text-sm">Od <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Do <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <Button variant={query.startsWith('scope=period') ? 'default' : 'outline'} onClick={() => setQuery(`scope=period&from=${from}&to=${to}`)}>Období</Button>
        <span className="flex-1" />
        <Button variant="outline" onClick={() => void download(`/api/admin/theatre-reports?${query}&format=csv`, 'report.csv').then(setErr)}>CSV</Button>
        <Button variant="outline" onClick={() => void download(`/api/admin/theatre-reports?${query}&format=xlsx`, 'report.xlsx').then(setErr)}>XLSX</Button>
        <Button onClick={() => void download(`/api/admin/events/${params.id}/usher-list?format=pdf`, 'uvadeci.pdf').then(setErr)}>Seznam pro uvaděče (PDF)</Button>
        <Button variant="outline" onClick={() => void download(`/api/admin/events/${params.id}/usher-list?format=csv`, 'uvadeci.csv').then(setErr)}>Uvaděči CSV</Button>
      </div>
      {err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{err}</p>}

      {rep && (
        <>
          <p className="text-sm text-slate-600">Termínů: {rep.events} · prodáno {rep.totals.sold} · tržba {kc(rep.totals.revenueMinor)}</p>
          <section>
            <h2 className="mb-1 font-semibold">Obsazenost</h2>
            <table className="min-w-full text-sm" data-testid="rep-occupancy">
              <thead><tr className="border-b text-left"><th className="p-2">Termín</th><th className="p-2">Sál</th><th className="p-2">Prodejná</th><th className="p-2">Prodáno</th><th className="p-2">Rezervováno</th><th className="p-2">Blokováno</th><th className="p-2">Obsazenost</th></tr></thead>
              <tbody>{rep.occupancy.map((o) => (
                <tr key={o.eventId} className="border-b"><td className="p-2">{o.title}<div className="text-xs text-slate-500">{new Date(o.dateStart).toLocaleString('cs-CZ')}</div></td>
                  <td className="p-2">{o.city}{o.hall ? ` · ${o.hall}` : ''}</td><td className="p-2">{o.sellable}</td><td className="p-2">{o.sold}</td><td className="p-2">{o.reserved}</td><td className="p-2">{o.blocked}</td>
                  <td className="p-2"><div className="h-2 w-24 rounded bg-slate-200"><div className="h-2 rounded bg-emerald-600" style={{ width: `${Math.min(100, o.occupiedPct)}%` }} /></div>{o.occupiedPct} %</td></tr>
              ))}</tbody>
            </table>
          </section>
          <section>
            <h2 className="mb-1 font-semibold">Prodej podle zóny, kategorie a kanálu</h2>
            <table className="min-w-full text-sm" data-testid="rep-sales">
              <thead><tr className="border-b text-left"><th className="p-2">Termín</th><th className="p-2">Zóna</th><th className="p-2">Kategorie</th><th className="p-2">Kanál</th><th className="p-2">Prodáno</th><th className="p-2">Tržba</th></tr></thead>
              <tbody>{rep.sales.map((s, i) => (
                <tr key={i} className="border-b"><td className="p-2">{new Date(s.dateStart).toLocaleDateString('cs-CZ')}</td><td className="p-2">{s.zone}</td><td className="p-2">{s.category}</td><td className="p-2">{CH[s.channel] ?? s.channel}</td><td className="p-2">{s.sold}</td><td className="p-2">{kc(s.revenueMinor)}</td></tr>
              ))}</tbody>
            </table>
          </section>
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-1 font-semibold">Blokace</h2>
              <table className="min-w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Blokace</th><th className="p-2">Celkem</th><th className="p-2">Uvolněno</th><th className="p-2">Vydáno</th><th className="p-2">Prodáno</th><th className="p-2">Zbývá</th></tr></thead>
                <tbody>{rep.blocks.map((b, i) => <tr key={i} className="border-b"><td className="p-2">{b.block}</td><td className="p-2">{b.total}</td><td className="p-2">{b.released}</td><td className="p-2">{b.issued}</td><td className="p-2">{b.sold}</td><td className="p-2">{b.remaining}</td></tr>)}</tbody></table>
            </section>
            <section>
              <h2 className="mb-1 font-semibold">Rezervace</h2>
              <table className="min-w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Termín</th><th className="p-2">Aktivní</th><th className="p-2">Zaplacené</th><th className="p-2">Propadlé</th><th className="p-2">Zrušené</th></tr></thead>
                <tbody>{rep.reservations.map((r) => <tr key={r.eventId} className="border-b"><td className="p-2">{r.title}</td><td className="p-2">{r.active}</td><td className="p-2">{r.paid}</td><td className="p-2">{r.expired} ({r.expiredSeats} míst)</td><td className="p-2">{r.cancelled}</td></tr>)}</tbody></table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
