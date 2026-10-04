'use client';

/**
 * Kolo 8 / krok 7 — zrušení a přesun termínu (C-14): přesun s novým datem a lhůtou pro vrácení (výchozí 14 dní),
 * zrušení s hromadným vrácením online plateb, dobropisy, zneplatněním vstupenek a e-maily; seznam plateb k ručnímu
 * vrácení (pokladna, firemní faktury, selhané refundy).
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ManualRefund { orderId: string; channel: string; buyer: string | null; email: string | null; amountMinor: number; currency: string; paymentType: string | null; invoiceNumber: string | null; note: string | null }
interface State { status: string; cancelled_at: string | null; cancellation_reason: string | null; manualRefunds: ManualRefund[] }

const api = (url: string, init?: RequestInit) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
};
const CHANNEL: Record<string, string> = { box_office: 'pokladna', corporate: 'firemní faktura', gateway_failed: 'refund brány selhal', other: 'jiné' };

export default function CancelPostponePage({ params }: { params: { id: string } }) {
  const [st, setSt] = useState<State | null>(null);
  const [newStart, setNewStart] = useState('');
  const [pReason, setPReason] = useState('');
  const [days, setDays] = useState('14');
  const [cReason, setCReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api(`/api/admin/events/${params.id}/cancel-term`);
    if (r.ok) setSt((await r.json()) as State);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function postpone() {
    setErr(null); setMsg(null);
    const r = await api(`/api/admin/events/${params.id}/postpone-term`, {
      method: 'POST', body: JSON.stringify({ newStart: new Date(newStart).toISOString(), reason: pReason, refundDays: Number(days) }),
    });
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; recipients?: number; responseDeadline?: string };
    if (!r.ok) { setErr(j.message ?? j.error ?? `HTTP ${r.status}`); return; }
    setMsg(`Termín přesunut. E-mail s odkazem na vrácení (do ${new Date(j.responseDeadline ?? '').toLocaleString('cs-CZ')}) odešel ${j.recipients ?? 0} kupcům.`);
  }

  async function cancel() {
    setErr(null); setMsg(null);
    const r = await api(`/api/admin/events/${params.id}/cancel-term`, { method: 'POST', body: JSON.stringify({ reason: cReason }) });
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; refunded?: number; refundFailed?: number; ticketsRevoked?: number; buyersEmailed?: number; manualRefunds?: ManualRefund[] };
    if (!r.ok) { setErr(j.message ?? j.error ?? `HTTP ${r.status}`); return; }
    setMsg(`Termín zrušen: vráceno online ${j.refunded ?? 0}, selhalo ${j.refundFailed ?? 0}, zneplatněno ${j.ticketsRevoked ?? 0} vstupenek, e-mailů ${j.buyersEmailed ?? 0}. K ručnímu vrácení: ${j.manualRefunds?.length ?? 0}.`);
    await load();
  }

  const cancelled = st?.status === 'cancelled';
  return (
    <div className="space-y-6 p-4">
      <h1 className="text-xl font-semibold">Zrušení a přesun termínu</h1>
      {msg && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800" data-testid="term-msg">{msg}</p>}
      {err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{err}</p>}
      {cancelled && <p className="rounded bg-rose-100 p-3 text-rose-900">Termín je zrušený ({st?.cancelled_at ? new Date(st.cancelled_at).toLocaleString('cs-CZ') : ''}): {st?.cancellation_reason}</p>}

      {!cancelled && (
        <section className="max-w-xl space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Přesunout termín</h2>
          <p className="text-sm text-slate-600">Vstupenky zůstanou platné. Kupci dostanou e-mail s novým datem a odkazem na vrácení vstupného.</p>
          <label className="block text-sm">Nové datum a čas <Input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} /></label>
          <Input placeholder="Důvod přesunu" value={pReason} onChange={(e) => setPReason(e.target.value)} />
          <label className="block text-sm">Lhůta pro vrácení (dní) <Input className="w-24" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          <Button onClick={() => void postpone()} disabled={!newStart || pReason.trim().length < 2}>Přesunout a informovat kupce</Button>
        </section>
      )}

      {!cancelled && (
        <section className="max-w-xl space-y-2 rounded-lg border border-rose-300 p-4">
          <h2 className="font-semibold text-rose-800">Zrušit termín</h2>
          <p className="text-sm text-slate-600">Zastaví prodej i rezervace, vrátí online platby přes bránu, vystaví dobropisy, zneplatní vstupenky a pošle kupcům e-mail. Nelze vrátit zpět.</p>
          <Input placeholder="Důvod zrušení (pošle se kupcům)" value={cReason} onChange={(e) => setCReason(e.target.value)} />
          <Input placeholder='Pro potvrzení napište „ZRUŠIT"' value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button variant="destructive" onClick={() => void cancel()} disabled={confirm !== 'ZRUŠIT' || cReason.trim().length < 2}>Zrušit termín</Button>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">K ručnímu vrácení</h2>
        <table className="min-w-full text-sm" data-testid="manual-refunds">
          <thead><tr className="border-b text-left"><th className="p-2">Kanál</th><th className="p-2">Kupec</th><th className="p-2">Částka</th><th className="p-2">Platba / doklad</th><th className="p-2">Pozn.</th></tr></thead>
          <tbody>
            {(st?.manualRefunds ?? []).map((m) => (
              <tr key={m.orderId} className="border-b">
                <td className="p-2">{CHANNEL[m.channel] ?? m.channel}</td>
                <td className="p-2">{m.buyer}<div className="text-xs text-slate-500">{m.email}</div></td>
                <td className="p-2">{(m.amountMinor / 100).toLocaleString('cs-CZ')} {m.currency}</td>
                <td className="p-2">{m.paymentType === 'cash' ? 'hotově' : m.paymentType === 'card' ? 'kartou' : ''}{m.invoiceNumber ? ` · faktura ${m.invoiceNumber}` : ''}</td>
                <td className="p-2 text-xs">{m.note}</td>
              </tr>
            ))}
            {(st?.manualRefunds ?? []).length === 0 && <tr><td className="p-2 text-slate-500" colSpan={5}>Nic k ručnímu vrácení.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
