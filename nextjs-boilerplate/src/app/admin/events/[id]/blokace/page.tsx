'use client';

/**
 * Kolo 8 / krok 3 — pojmenované blokace míst termínu: plánek s barvami blokací, přehled
 * (blokace | míst celkem | uvolněno | vydáno | prodáno | zbývá), založení z výběru nebo celé sekce,
 * uvolnění vybraných / všech míst, volné vstupenky na jména. Prodej firmě: Firemní objednávky; na pokladně: Pokladna.
 */
import { useEffect, useMemo, useState, use } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Block { id: string; name: string; note: string | null; color: string; total: number; blocked: number; released: number; issued: number; sold: number }
interface Seat { id: string; sector: string; row: string; seat_number: string; x: number | null; y: number | null; status: string; blockId: string | null; color: string | null; blockName: string | null }

const api = (url: string, init?: RequestInit) => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
};
const COLORS = ['#7c3aed', '#dc2626', '#0891b2', '#d97706', '#16a34a', '#db2777'];

export default function BlocksPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [sector, setSector] = useState('');
  const [compNames, setCompNames] = useState<Record<string, string>>({});
  const [compBlock, setCompBlock] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const r = await api(`/api/admin/events/${params.id}/blocks`);
    if (!r.ok) { setErr(`Načtení selhalo (HTTP ${r.status}).`); return; }
    const j = (await r.json()) as { blocks: Block[]; seats: Seat[] };
    setBlocks(j.blocks); setSeats(j.seats);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.id]);

  const sectors = useMemo(() => [...new Set(seats.map((s) => s.sector))], [seats]);
  const bounds = useMemo(() => {
    const xs = seats.map((s) => s.x ?? 0), ys = seats.map((s) => s.y ?? 0);
    return { minX: Math.min(0, ...xs) - 30, minY: Math.min(0, ...ys) - 30, w: Math.max(400, ...xs) + 60, h: Math.max(200, ...ys) + 60 };
  }, [seats]);

  async function run(url: string, body: unknown, ok: (j: Record<string, unknown>) => string) {
    setErr(null); setMsg(null);
    const r = await api(url, { method: 'POST', body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) { setErr(String(j.message ?? j.error ?? `HTTP ${r.status}`)); return; }
    setMsg(ok(j)); setSel(new Set()); await load();
  }

  const createBlock = () => run(`/api/admin/events/${params.id}/blocks`, {
    name, note: note || null, color: COLORS[blocks.length % COLORS.length],
    ...(sector ? { sector } : { seatIds: [...sel] }),
  }, (j) => `Blokace „${name}" založena: ${String(j.blocked)} míst${(j.skipped as unknown[]).length ? `, ${(j.skipped as unknown[]).length} obsazených přeskočeno` : ''}.`).then(() => { setName(''); setNote(''); setSector(''); });

  const release = (b: Block, onlySelected: boolean) => run(`/api/admin/events/${params.id}/blocks/${b.id}/release`,
    onlySelected ? { seatIds: seats.filter((s) => sel.has(s.id) && s.blockId === b.id).map((s) => s.id) } : {},
    (j) => `Uvolněno ${String(j.released)} míst z blokace „${b.name}".`);

  const compSeats = seats.filter((s) => sel.has(s.id) && s.blockId === compBlock);
  const issueComps = () => run(`/api/admin/events/${params.id}/blocks/${compBlock}/comps`, {
    seats: compSeats.map((s) => ({ seatId: s.id, holderName: (compNames[s.id] ?? '').trim() })),
  }, (j) => `Vydáno ${String(j.tickets)} volných vstupenek.`);

  return (
    <div className="space-y-6" data-testid="blocks-page">
      <h2 className="text-xl font-semibold">Blokace míst</h2>
      {msg ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" data-testid="blocks-msg">{msg}</p> : null}
      {err ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{err}</p> : null}

      <div className="overflow-x-auto rounded-lg border bg-card p-2">
        <svg viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`} className="h-auto w-full min-w-[320px]" role="img" aria-label="Plánek s blokacemi">
          {seats.map((s) => {
            const picked = sel.has(s.id);
            const fill = s.blockId ? s.color ?? '#6b7280' : s.status === 'available' ? '#e5e7eb' : '#9ca3af';
            return (
              <circle key={s.id} cx={s.x ?? 0} cy={s.y ?? 0} r={8} fill={fill} stroke={picked ? '#000' : '#fff'} strokeWidth={picked ? 3 : 1}
                style={{ cursor: 'pointer' }} data-seat-block={s.blockName ?? ''}
                onClick={() => { const n = new Set(sel); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); setSel(n); }}>
                <title>{`${s.sector} řada ${s.row} místo ${s.seat_number}${s.blockName ? ` — ${s.blockName}` : ` — ${s.status}`}`}</title>
              </circle>
            );
          })}
        </svg>
        <p className="px-2 text-xs text-muted-foreground">Klikem vyberte místa (vybráno {sel.size}). Barva = blokace, šedá = prodáno/obsazeno, světlá = volné.</p>
      </div>

      <section className="rounded-lg border bg-card p-4">
        <h3 className="mb-2 font-semibold">Přehled</h3>
        <table className="w-full text-sm" data-testid="blocks-table">
          <thead><tr className="text-left text-muted-foreground"><th>Blokace</th><th>Míst celkem</th><th>Uvolněno</th><th>Vydáno</th><th>Prodáno</th><th>Zbývá</th><th /></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="py-1"><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: b.color }} />{b.name}{b.note ? <span className="block text-xs text-muted-foreground">{b.note}</span> : null}</td>
                <td>{b.total}</td><td>{b.released}</td><td>{b.issued}</td><td>{b.sold}</td><td>{b.blocked}</td>
                <td className="space-x-1 whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" onClick={() => void release(b, true)}>Uvolnit vybraná</Button>
                  <Button size="sm" variant="outline" onClick={() => void release(b, false)}>Uvolnit vše</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <h3 className="font-semibold">Nová blokace</h3>
          <Input placeholder="Název (Firma XY, Tisk, Technika…)" value={name} onChange={(e) => setName(e.target.value)} data-testid="block-name" />
          <Input placeholder="Poznámka" value={note} onChange={(e) => setNote(e.target.value)} />
          <label className="block text-sm">Celá sekce (jinak vybraná místa)
            <select className="mt-1 block w-full rounded-md border bg-background p-2" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">— vybraná místa ({sel.size}) —</option>
              {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <Button onClick={() => void createBlock()} disabled={!name.trim() || (!sector && sel.size === 0)} data-testid="block-create">Zablokovat</Button>
        </div>
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <h3 className="font-semibold">Volné vstupenky z blokace</h3>
          <select className="block w-full rounded-md border bg-background p-2 text-sm" value={compBlock} onChange={(e) => setCompBlock(e.target.value)}>
            <option value="">— blokace —</option>
            {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {compSeats.map((s) => (
            <label key={s.id} className="block text-sm">{s.sector} řada {s.row} místo {s.seat_number}
              <Input placeholder="Jméno držitele" value={compNames[s.id] ?? ''} onChange={(e) => setCompNames({ ...compNames, [s.id]: e.target.value })} />
            </label>
          ))}
          <Button onClick={() => void issueComps()} disabled={!compBlock || compSeats.length === 0 || compSeats.some((s) => !(compNames[s.id] ?? '').trim())}>Vydat na jména</Button>
          <p className="text-xs text-muted-foreground">Vyberte v plánku místa z dané blokace a vyplňte jména.</p>
        </div>
      </section>
    </div>
  );
}
