'use client';

/**
 * Kolo 8 / krok 5 — rezervace s platbou na pokladně: nastavení termínu (povolit, lhůta N dní, nejpozději M hodin
 * před začátkem), obsazenost prodáno vs. rezervováno, seznam rezervací a pokladna: hledání podle kódu / jména /
 * e-mailu / telefonu, platba hotově nebo kartou → vstupenky + doklad.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { errorText } from '@/lib/ui/error-text';

interface Reservation {
  id: string; code: string; buyerName: string; buyerEmail: string; buyerPhone: string | null; seatCount: number;
  status: string; expiresAt: string; totalMinor: number; paymentType?: string | null;
  seats?: Array<{ sector: string; row: string; seat: string; category: string | null }>;
}
interface Data {
  settings: { enabled: boolean; days: number; cutoffHours: number };
  occupancy: { capacity: number; sold: number; reserved: number; blocked: number; occupiedPct: number };
  counts: Record<string, number>;
  reservations: Reservation[];
}

const api = (url: string, init?: RequestInit) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
};
const kc = (m: number) => `${(m / 100).toLocaleString('cs-CZ')} Kč`;
const STATUS: Record<string, string> = { active: 'aktivní', paid: 'zaplaceno', expired: 'propadlá', cancelled: 'zrušená' };

export default function ReservationsPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState({ enabled: false, days: '5', cutoffHours: '2' });
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Reservation[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Kolo 12: po zaplacení rovnou tisk vstupenek (dřív chyběl)
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null);

  async function load() {
    const r = await api(`/api/admin/events/${params.id}/reservations`);
    if (!r.ok) { setErr(`Rezervace se nepodařilo načíst. ${errorText({}, r.status)}`); return; }
    const j = (await r.json()) as Data;
    setData(j);
    setForm({ enabled: j.settings.enabled, days: String(j.settings.days), cutoffHours: String(j.settings.cutoffHours) });
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function saveSettings() {
    setErr(null); setMsg(null);
    const r = await api(`/api/admin/events/${params.id}/reservations`, {
      method: 'PATCH', body: JSON.stringify({ enabled: form.enabled, days: Number(form.days), cutoffHours: Number(form.cutoffHours) }),
    });
    if (!r.ok) { setErr(`Nastavení se nepodařilo uložit. ${errorText(await r.json().catch(() => ({})), r.status)}`); return; }
    setMsg('Nastavení rezervací uloženo.'); await load();
  }

  async function search() {
    setErr(null);
    const r = await api(`/api/admin/seat-reservations?eventId=${params.id}&q=${encodeURIComponent(q)}`);
    const j = (await r.json().catch(() => ({}))) as { reservations?: Reservation[]; error?: string };
    if (!r.ok) { setErr(errorText(j, r.status)); return; }
    setFound(j.reservations ?? []);
  }

  async function pay(res: Reservation, paymentType: 'cash' | 'card') {
    setErr(null); setMsg(null); setPaidOrderId(null);
    const r = await api(`/api/admin/seat-reservations/${res.id}/pay`, { method: 'POST', body: JSON.stringify({ paymentType }) });
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; receiptNumber?: string; tickets?: unknown[]; orderId?: string };
    if (!r.ok) { setErr(errorText(j, r.status)); return; }
    setPaidOrderId(j.orderId ?? null);
    setMsg(`Rezervace ${res.code} zaplacena (${paymentType === 'cash' ? 'hotově' : 'kartou'}): ${j.tickets?.length ?? 0} vstupenek, doklad ${j.receiptNumber ?? ''}.`);
    setFound(null); setQ(''); await load();
  }

  const list = found ?? data?.reservations ?? [];

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-xl font-semibold">Rezervace s platbou na pokladně</h1>
      {msg && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800" data-testid="res-msg">{msg}</p>}
      {msg && paidOrderId ? (
        <a href={`/api/admin/orders/${paidOrderId}/print-labels`} target="_blank" rel="noopener noreferrer"
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90" data-testid="res-print">
          Vytisknout vstupenky (s QR kódem)
        </a>
      ) : null}
      {err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{err}</p>}

      {data && (
      <section className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Povolit rezervace
        </label>
        <label className="text-sm">Lhůta (dní od vytvoření)
          <Input className="w-24" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
        </label>
        <label className="text-sm">Nejpozději hodin před začátkem
          <Input className="w-24" value={form.cutoffHours} onChange={(e) => setForm({ ...form, cutoffHours: e.target.value })} />
        </label>
        <Button onClick={() => void saveSettings()}>Uložit</Button>
      </section>
      )}

      {data && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="res-occupancy">
          {[
            ['Kapacita', data.occupancy.capacity], ['Prodáno', data.occupancy.sold], ['Rezervováno', data.occupancy.reserved],
            ['Blokováno', data.occupancy.blocked], ['Obsazenost', `${data.occupancy.occupiedPct} %`],
          ].map(([l, v]) => (
            <div key={String(l)} className="rounded-lg border p-3"><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{v}</div></div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex gap-2">
          <Input placeholder="Kód, jméno, e-mail nebo telefon" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} />
          <Button onClick={() => void search()} disabled={q.trim().length < 2}>Hledat</Button>
          {found && <Button variant="outline" onClick={() => { setFound(null); setQ(''); }}>Vše</Button>}
        </div>
        <table className="min-w-full text-sm" data-testid="res-table">
          <thead><tr className="border-b text-left"><th className="p-2">Kód</th><th className="p-2">Kupec</th><th className="p-2">Míst</th><th className="p-2">Cena</th><th className="p-2">Lhůta</th><th className="p-2">Stav</th><th /></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b align-top">
                <td className="p-2 font-mono font-semibold">{r.code}</td>
                <td className="p-2">{r.buyerName}<div className="text-xs text-slate-500">{r.buyerEmail}{r.buyerPhone ? ` · ${r.buyerPhone}` : ''}</div>
                  {r.seats && <div className="text-xs">{r.seats.map((s) => `${s.sector} ř. ${s.row} m. ${s.seat}${s.category ? ` (${s.category})` : ''}`).join(', ')}</div>}
                </td>
                <td className="p-2">{r.seatCount}</td>
                <td className="p-2">{kc(r.totalMinor)}</td>
                <td className="p-2">{new Date(r.expiresAt).toLocaleString('cs-CZ')}</td>
                <td className="p-2">{STATUS[r.status] ?? r.status}{r.paymentType ? ` (${r.paymentType === 'cash' ? 'hotově' : 'kartou'})` : ''}</td>
                <td className="p-2">
                  {r.status === 'active' && (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => void pay(r, 'cash')}>Hotově</Button>
                      <Button size="sm" variant="outline" onClick={() => void pay(r, 'card')}>Kartou</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td className="p-2 text-slate-500" colSpan={7}>Žádné rezervace.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
