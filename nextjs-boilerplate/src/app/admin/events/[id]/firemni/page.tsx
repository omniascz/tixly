'use client';

/**
 * Kolo 8 / krok 6 — firemní / skupinové objednávky na fakturu: firma podle IČO (ARES), místa z volného prodeje nebo
 * z blokace, kategorie, upravená cena s důvodem, splatnost → faktura (PDF + ISDOC) e-mailem; zaplaceno → vstupenky;
 * zrušit / uvolnit místa → dobropis.
 */
import { useEffect, useMemo, useState, use } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Seat { id: string; sector: string; row: string; seat_number: string; status: string; blockId: string | null; blockName: string | null }
interface Block { id: string; name: string; blocked: number }
interface Category { id: string; name: string; kind?: string }
interface Order {
  id: string; companyName: string; companyIco: string; contactEmail: string; status: string; dueDate: string; totalMinor: number;
  invoiceNumber: string | null; invoiceId: string | null; creditNoteId: string | null; seats: number; blockName: string | null; paymentReference: string | null;
}

const api = (url: string, init?: RequestInit) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
};
const kc = (m: number) => `${(m / 100).toLocaleString('cs-CZ')} Kč`;
const STATUS: Record<string, string> = { confirmed: 'čeká na platbu', overdue: 'po splatnosti', paid: 'zaplaceno', cancelled: 'zrušeno' };
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export default function CorporateOrdersPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [source, setSource] = useState<string>('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [catId, setCatId] = useState('');
  const [company, setCompany] = useState({ ico: '', name: '', dic: '', address: '' });
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [unitPrice, setUnitPrice] = useState('');
  const [reason, setReason] = useState('');
  const [dueDate, setDueDate] = useState(inDays(14));
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const [b, c, o] = await Promise.all([
      api(`/api/admin/events/${params.id}/blocks`), api(`/api/admin/events/${params.id}/categories`), api(`/api/admin/corporate-orders?eventId=${params.id}`),
    ]);
    if (b.ok) { const j = (await b.json()) as { blocks: Block[]; seats: Seat[] }; setBlocks(j.blocks); setSeats(j.seats); }
    if (c.ok) {
      const j = (await c.json()) as { categories: Category[] };
      setCats(j.categories);
      // výchozí = plné vstupné (ne první v seznamu)
      const full = j.categories.find((x) => x.kind === 'full') ?? j.categories[0];
      if (!catId && full) setCatId(full.id);
    }
    if (o.ok) setOrders(((await o.json()) as { orders: Order[] }).orders);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const offer = useMemo(
    () => seats.filter((s) => (source ? s.blockId === source : s.status === 'available')),
    [seats, source],
  );

  async function ares() {
    setErr(null);
    const r = await api(`/api/admin/ares/${company.ico}`);
    const j = (await r.json().catch(() => ({}))) as { name?: string; address?: string; dic?: string; message?: string; error?: string };
    if (!r.ok) { setErr(j.message ?? j.error ?? `ARES: HTTP ${r.status}`); return; }
    setCompany({ ...company, name: j.name ?? '', address: j.address ?? '', dic: j.dic ?? '' });
  }

  async function create() {
    setErr(null); setMsg(null);
    const price = unitPrice.trim() ? Math.round(Number(unitPrice) * 100) : undefined;
    const r = await api('/api/admin/corporate-orders', {
      method: 'POST',
      body: JSON.stringify({
        eventId: params.id, blockId: source || null, dueDate,
        company: { ...company, dic: company.dic || null }, contact: { ...contact, phone: contact.phone || null },
        seats: [...sel].map((seatId) => ({ seatId, categoryId: catId, ...(price !== undefined ? { priceMinor: price } : {}) })),
        priceOverrideReason: reason || null,
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; invoiceNumber?: string; totalMinor?: number };
    if (!r.ok) { setErr(j.message ?? j.error ?? `HTTP ${r.status}`); return; }
    setMsg(`Objednávka založena, faktura ${j.invoiceNumber ?? ''} (${kc(j.totalMinor ?? 0)}) odeslána na ${contact.email}.`);
    setSel(new Set()); await load();
  }

  async function act(o: Order, kind: 'paid' | 'cancel') {
    setErr(null); setMsg(null);
    let body: unknown;
    if (kind === 'paid') {
      const ref = window.prompt('Reference platby (VS / ID transakce):', o.invoiceNumber ?? '');
      if (!ref) return;
      body = { paidOn: new Date().toISOString().slice(0, 10), paymentReference: ref };
    } else {
      const why = window.prompt('Důvod zrušení / uvolnění míst:', '');
      if (!why) return;
      body = { reason: why };
    }
    const r = await api(`/api/admin/corporate-orders/${o.id}/${kind}`, { method: 'POST', body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string; tickets?: number; seatsReturned?: number };
    if (!r.ok) { setErr(j.message ?? j.error ?? `HTTP ${r.status}`); return; }
    setMsg(kind === 'paid' ? `Zaplaceno — ${j.tickets ?? 0} vstupenek odesláno na ${o.contactEmail}.` : `Zrušeno — dobropis vystaven, ${j.seatsReturned ?? 0} míst vráceno.`);
    await load();
  }

  return (
    <div className="space-y-6 p-4">
      <h1 className="text-xl font-semibold">Firemní objednávky na fakturu</h1>
      {msg && <p className="rounded bg-emerald-50 p-2 text-sm text-emerald-800" data-testid="corp-msg">{msg}</p>}
      {err && <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{err}</p>}

      <section className="grid gap-4 rounded-lg border p-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h2 className="font-semibold">Firma</h2>
          <div className="flex gap-2">
            <Input placeholder="IČO" value={company.ico} onChange={(e) => setCompany({ ...company, ico: e.target.value })} />
            <Button variant="outline" onClick={() => void ares()} disabled={!/^\d{8}$/.test(company.ico)}>Načíst z ARES</Button>
          </div>
          <Input placeholder="Název firmy" value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} />
          <Input placeholder="DIČ" value={company.dic} onChange={(e) => setCompany({ ...company, dic: e.target.value })} />
          <Input placeholder="Sídlo" value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} />
          <h2 className="pt-2 font-semibold">Kontakt</h2>
          <Input placeholder="Jméno" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
          <Input placeholder="E-mail" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
          <Input placeholder="Telefon" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
        </div>
        <div className="space-y-2">
          <h2 className="font-semibold">Místa</h2>
          <select className="w-full rounded border px-2 py-2" value={source} onChange={(e) => { setSource(e.target.value); setSel(new Set()); }}>
            <option value="">Volná místa</option>
            {blocks.map((b) => <option key={b.id} value={b.id}>Blokace: {b.name} ({b.blocked} míst)</option>)}
          </select>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSel(new Set(offer.map((s) => s.id)))}>Vybrat vše ({offer.length})</Button>
            <Button variant="outline" size="sm" onClick={() => setSel(new Set())}>Zrušit výběr</Button>
            <span className="self-center text-sm">vybráno {sel.size}</span>
          </div>
          <div className="flex max-h-48 flex-wrap gap-1 overflow-auto rounded border p-2">
            {offer.map((s) => (
              <button key={s.id} type="button"
                onClick={() => { const n = new Set(sel); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setSel(n); }}
                className={`rounded px-2 py-1 text-xs ${sel.has(s.id) ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>
                {s.sector} {s.row}/{s.seat_number}
              </button>
            ))}
          </div>
          <select className="w-full rounded border px-2 py-2" value={catId} onChange={(e) => setCatId(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Upravená cena za místo (Kč)" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            <Input placeholder="Důvod úpravy ceny" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <label className="block text-sm">Splatnost <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
          <Button onClick={() => void create()} disabled={sel.size === 0 || !company.name || !contact.email || !catId}>Vytvořit objednávku a fakturu</Button>
        </div>
      </section>

      <table className="min-w-full text-sm" data-testid="corp-table">
        <thead><tr className="border-b text-left"><th className="p-2">Firma</th><th className="p-2">Míst</th><th className="p-2">Celkem</th><th className="p-2">Faktura</th><th className="p-2">Splatnost</th><th className="p-2">Stav</th><th /></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-b">
              <td className="p-2">{o.companyName}<div className="text-xs text-slate-500">IČO {o.companyIco}{o.blockName ? ` · z blokace ${o.blockName}` : ''}</div></td>
              <td className="p-2">{o.seats}</td>
              <td className="p-2">{kc(o.totalMinor)}</td>
              <td className="p-2">
                {o.invoiceId && <><a className="underline" href={`/api/admin/invoices/${o.invoiceId}/pdf`}>{o.invoiceNumber}</a> · <a className="underline" href={`/api/admin/invoices/${o.invoiceId}/isdoc`}>ISDOC</a></>}
                {o.creditNoteId && <div className="text-xs"><a className="underline" href={`/api/admin/invoices/${o.creditNoteId}/pdf`}>dobropis</a></div>}
              </td>
              <td className="p-2">{o.dueDate}</td>
              <td className="p-2">{STATUS[o.status] ?? o.status}{o.paymentReference ? <div className="text-xs">ref. {o.paymentReference}</div> : null}</td>
              <td className="p-2">
                <div className="flex gap-1">
                  {['confirmed', 'overdue'].includes(o.status) && <Button size="sm" onClick={() => void act(o, 'paid')}>Zaplaceno</Button>}
                  {o.status !== 'cancelled' && <Button size="sm" variant="outline" onClick={() => void act(o, 'cancel')}>Zrušit / uvolnit</Button>}
                </div>
              </td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td className="p-2 text-slate-500" colSpan={7}>Zatím žádné firemní objednávky.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
