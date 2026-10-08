'use client';

/**
 * Kolo 8 / krok 4 — slevové kategorie termínu: ceník kategorie × zóna (procento z plné ceny nebo pevná částka),
 * výchozí šablona jedním krokem, nová / upravená kategorie (průkaz při vstupu, limit kusů na termín),
 * výjimka ceny pro konkrétní zónu. Ceny se při nákupu vždy počítají na serveru.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Category { id: string; code: string; name: string; kind: string; price_mode: 'percent' | 'fixed'; price_value: number; requires_proof: boolean; proof_label: string | null; limit_per_event: number | null }
interface Zone { id: string; name: string; base_price: number }
interface Price { categoryId: string; ticketTypeId: string; priceMinor: number }

const api = (url: string, init?: RequestInit) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
};
const KINDS: Array<[string, string]> = [['full', 'Plné'], ['senior', 'Senior'], ['student', 'Student'], ['ztp', 'ZTP'], ['ztpp', 'ZTP/P'], ['ztpp_companion', 'Doprovod ZTP/P'], ['child', 'Dítě'], ['custom', 'Vlastní']];
const kc = (minor: number) => `${(minor / 100).toLocaleString('cs-CZ')} Kč`;
const empty = { code: '', name: '', kind: 'custom', priceMode: 'percent' as 'percent' | 'fixed', price: '100', requiresProof: false, proofLabel: '', limit: '' };

export default function CategoriesPage(_props: { params: Promise<{ id: string }> }) {
  const params = useParams<{ id: string }>();
  const [cats, setCats] = useState<Category[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api(`/api/admin/events/${params.id}/categories`);
    if (!r.ok) { setErr(`Načtení selhalo (HTTP ${r.status}).`); return; }
    const j = (await r.json()) as { categories: Category[]; zones: Zone[]; prices: Price[] };
    setCats(j.categories); setZones(j.zones); setPrices(j.prices);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function send(url: string, method: string, body: unknown, ok: string) {
    setErr(null); setMsg(null);
    const r = await api(url, { method, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) { setErr(String(j.message ?? j.error ?? `HTTP ${r.status}`)); return false; }
    setMsg(ok); await load(); return true;
  }

  const applyTemplate = () => send(`/api/admin/events/${params.id}/categories`, 'POST', { applyTemplate: true }, 'Výchozí šablona kategorií použita.');

  async function save() {
    // procento × 100, resp. Kč → haléře
    const priceValue = Math.round(Number(form.price) * 100);
    const ok = await send(`/api/admin/events/${params.id}/categories`, 'POST', {
      code: form.code, name: form.name, kind: form.kind, priceMode: form.priceMode, priceValue,
      requiresProof: form.requiresProof, proofLabel: form.proofLabel || null, limitPerEvent: form.limit ? Number(form.limit) : null,
    }, `Kategorie „${form.name}" uložena.`);
    if (ok) setForm(empty);
  }

  function edit(c: Category) {
    setForm({
      code: c.code, name: c.name, kind: c.kind, priceMode: c.price_mode, price: String(c.price_value / 100),
      requiresProof: c.requires_proof, proofLabel: c.proof_label ?? '', limit: c.limit_per_event ? String(c.limit_per_event) : '',
    });
  }

  async function zonePrice(c: Category, z: Zone, current: number) {
    const v = window.prompt(`Cena „${c.name}" v zóně ${z.name} (Kč, pevná částka):`, String(current / 100));
    if (v === null || v.trim() === '' || Number.isNaN(Number(v))) return;
    await send(`/api/admin/events/${params.id}/categories/${c.id}/prices`, 'PUT',
      { ticketTypeId: z.id, priceMode: 'fixed', priceValue: Math.round(Number(v) * 100) }, `Cena v zóně ${z.name} upravena.`);
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Slevové kategorie</h1>
        <Button onClick={() => void applyTemplate()} data-testid="apply-template">Použít výchozí šablonu</Button>
      </div>
      {msg && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}
      {err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{err}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="category-table">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">Kategorie</th><th className="p-2">Pravidlo</th><th className="p-2">Průkaz</th><th className="p-2">Limit</th>
              {zones.map((z) => <th key={z.id} className="p-2">{z.name}<div className="font-normal text-slate-500">plné {kc(z.base_price)}</div></th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="p-2 font-medium">{c.name}<div className="text-xs text-slate-500">{c.code}</div></td>
                <td className="p-2">{c.price_mode === 'percent' ? `${c.price_value / 100} % z plné` : kc(c.price_value)}</td>
                <td className="p-2">{c.requires_proof ? (c.proof_label ?? 'ano') : '—'}</td>
                <td className="p-2">{c.limit_per_event ?? '—'}</td>
                {zones.map((z) => {
                  const p = prices.find((x) => x.categoryId === c.id && x.ticketTypeId === z.id)?.priceMinor ?? 0;
                  return <td key={z.id} className="p-2"><button className="underline decoration-dotted" onClick={() => void zonePrice(c, z, p)}>{kc(p)}</button></td>;
                })}
                <td className="p-2"><Button variant="outline" size="sm" onClick={() => edit(c)}>Upravit</Button></td>
              </tr>
            ))}
            {cats.length === 0 && <tr><td className="p-2 text-slate-500" colSpan={5 + zones.length}>Termín zatím nemá kategorie — použijte výchozí šablonu nebo přidejte vlastní.</td></tr>}
          </tbody>
        </table>
      </div>

      <section className="max-w-xl space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold">Přidat / upravit kategorii</h2>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="Kód (např. senior)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <Input placeholder="Název" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="rounded border px-2" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select className="rounded border px-2" value={form.priceMode} onChange={(e) => setForm({ ...form, priceMode: e.target.value as 'percent' | 'fixed' })}>
            <option value="percent">% z plné ceny</option><option value="fixed">pevná částka (Kč)</option>
          </select>
          <Input placeholder={form.priceMode === 'percent' ? 'Procento' : 'Kč'} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <Input placeholder="Limit kusů na termín" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresProof} onChange={(e) => setForm({ ...form, requiresProof: e.target.checked })} /> Průkaz při vstupu</label>
          <Input placeholder="Text průkazu (ZTP/P…)" value={form.proofLabel} onChange={(e) => setForm({ ...form, proofLabel: e.target.value })} />
        </div>
        <Button onClick={() => void save()} disabled={!form.code || !form.name}>Uložit kategorii</Button>
      </section>
    </div>
  );
}
