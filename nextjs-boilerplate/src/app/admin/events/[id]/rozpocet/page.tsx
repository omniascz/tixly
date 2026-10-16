'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

const CATEGORIES = [
  { value: 'venue', label: 'Pronájem sálu' },
  { value: 'production', label: 'Technika a produkce' },
  { value: 'staff', label: 'Personál' },
  { value: 'artist', label: 'Honoráře' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'travel', label: 'Doprava' },
  { value: 'accommodation', label: 'Ubytování' },
  { value: 'catering', label: 'Občerstvení a rider' },
  { value: 'rights', label: 'Autorské poplatky' },
  { value: 'insurance', label: 'Pojištění' },
  { value: 'security', label: 'Ostraha' },
  { value: 'other', label: 'Ostatní' },
] as const;

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);

interface CostRow {
  id: string;
  category: string;
  description: string;
  amountMinor: number;
  vatRatePct: number;
  isPerAttendee: boolean;
  supplier: string | null;
  dueDate: string | null;
  paid: boolean;
  fromAgreement: boolean;
  notes: string | null;
}

interface BreakEven {
  costs: { fixedMinor: number; perAttendeeMinor: number; fixedVatMinor: number };
  contributionPerTicketMinor: number;
  ticketsNeeded: number | null;
  ticketsRemaining: number | null;
  ticketsSold: number;
  ticketsAvailable: number;
  coveragePct: number;
  reachable: boolean;
  currentResultMinor: number;
  soldOutResultMinor: number;
  summary: string;
  artistFeesCurrentMinor: number;
  dealCount: number;
}

interface Scenario {
  label: string;
  ticketsSold: number;
  resultMinor: number;
  artistFeesMinor: number;
}

function kc(minor: number): string {
  return `${(minor / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

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

export default function RozpocetPage(_props: { params: Promise<{ id: string }> }) {
  const params = useParams<{ id: string }>();
  const { id: eventId } = useRouteParams(params);

  const [costs, setCosts] = useState<CostRow[]>([]);
  const [summary, setSummary] = useState<{
    fixedMinor: number;
    perAttendeeMinor: number;
    vatPayer: boolean;
    byCategory: Record<string, number>;
  } | null>(null);
  const [be, setBe] = useState<BreakEven | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nová položka
  const [category, setCategory] = useState<string>('venue');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [vatRate, setVatRate] = useState('21');
  const [perAttendee, setPerAttendee] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const [cRes, bRes] = await Promise.all([
        authFetch(`/api/admin/events/${eventId}/costs`),
        authFetch(`/api/admin/events/${eventId}/break-even`),
      ]);
      if (cRes.ok) {
        const j = (await cRes.json()) as { costs: CostRow[]; summary: typeof summary };
        setCosts(j.costs);
        setSummary(j.summary);
      }
      if (bRes.ok) {
        const j = (await bRes.json()) as { breakEven: BreakEven; scenarios: Scenario[] };
        setBe(j.breakEven);
        setScenarios(j.scenarios);
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addCost(): Promise<void> {
    const amountMinor = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!description.trim() || !Number.isFinite(amountMinor) || amountMinor < 0) {
      setError('Vyplň popis a částku.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/costs`, {
        method: 'POST',
        body: JSON.stringify({
          category,
          description: description.trim(),
          amountMinor,
          vatRatePct: Number(vatRate) || 0,
          isPerAttendee: perAttendee,
          supplier: supplier.trim() || undefined,
          dueDate: dueDate || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        setError(j.message ?? j.error ?? `Nepodařilo se uložit (HTTP ${res.status}).`);
        return;
      }
      setDescription('');
      setAmount('');
      setSupplier('');
      setDueDate('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removeCost(id: string): Promise<void> {
    setBusy(true);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/costs/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setError(j.message ?? `Nepodařilo se smazat (HTTP ${res.status}).`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function togglePaid(c: CostRow): Promise<void> {
    setBusy(true);
    try {
      await authFetch(`/api/admin/events/${eventId}/costs/${c.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paid: !c.paid }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const coverage = be ? Math.min(100, be.coveragePct) : 0;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Rozpočet a bod zlomu"
        description="Náklady akce a kolik vstupenek ještě chybí, aby se akce zaplatila."
      />

      {be ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Pevné náklady</div>
                <div className="text-2xl font-bold tabular-nums">{kc(be.costs.fixedMinor)}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Příspěvek vstupenky</div>
                <div className="text-2xl font-bold tabular-nums">
                  {kc(be.contributionPerTicketMinor)}
                </div>
                <div className="text-[11px] text-muted-foreground">po DPH, provizi a nákladu na hlavu</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Bod zlomu</div>
                <div className="text-2xl font-bold tabular-nums">
                  {be.ticketsNeeded === null ? '—' : `${be.ticketsNeeded} ks`}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  prodáno {be.ticketsSold} z {be.ticketsAvailable}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Výsledek teď</div>
                <div
                  className={`text-2xl font-bold tabular-nums ${be.currentResultMinor < 0 ? 'text-rose-700' : 'text-emerald-700'}`}
                >
                  {kc(be.currentResultMinor)}
                </div>
                {be.dealCount > 0 ? (
                  <div className="text-[11px] text-muted-foreground">
                    po honorářích {kc(be.artistFeesCurrentMinor)} ({be.dealCount}{' '}
                    {be.dealCount === 1 ? 'smlouva' : be.dealCount < 5 ? 'smlouvy' : 'smluv'})
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${be.reachable ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{ width: `${coverage}%` }}
                />
              </div>
              <p className="mt-2 text-sm">{be.summary}</p>
            </div>

            {scenarios.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {scenarios.map((s) => (
                  <div key={s.label} className="rounded-md border p-3">
                    <div className="text-xs uppercase text-muted-foreground">{s.label}</div>
                    <div
                      className={`text-lg font-bold tabular-nums ${s.resultMinor < 0 ? 'text-rose-700' : 'text-emerald-700'}`}
                    >
                      {kc(s.resultMinor)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      při {s.ticketsSold} prodaných
                      {s.artistFeesMinor > 0 ? `, honoráře ${kc(s.artistFeesMinor)}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Přidat náklad</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Kategorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="např. pronájem sálu včetně úklidu"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Částka bez DPH</label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">DPH %</label>
              <Input value={vatRate} onChange={(e) => setVatRate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Dodavatel</label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Splatnost</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={perAttendee}
                  onChange={(e) => setPerAttendee(e.target.checked)}
                />
                Na návštěvníka
              </label>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            „Na návštěvníka" je náklad, který roste s každým prodaným místem — náramek, tisk
            vstupenky, odbavení. Snižuje příspěvek každé vstupenky, nikoli pevnou část rozpočtu.
          </p>
          <Button onClick={addCost} disabled={busy}>
            {busy ? 'Ukládám…' : 'Přidat do rozpočtu'}
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {costs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Rozpočet je prázdný. Bez nákladů nejde spočítat, kdy se akce zaplatí.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2">Kategorie</th>
                <th className="px-3 py-2">Popis</th>
                <th className="px-3 py-2 text-right">Částka</th>
                <th className="px-3 py-2">DPH</th>
                <th className="px-3 py-2">Typ</th>
                <th className="px-3 py-2">Splatnost</th>
                <th className="px-3 py-2">Zaplaceno</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id} className="border-t text-xs">
                  <td className="px-3 py-2">{CATEGORY_LABEL[c.category] ?? c.category}</td>
                  <td className="px-3 py-2">
                    {c.description}
                    {c.fromAgreement ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        ze smlouvy
                      </span>
                    ) : null}
                    {c.supplier ? (
                      <span className="block text-[11px] text-muted-foreground">{c.supplier}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{kc(c.amountMinor)}</td>
                  <td className="px-3 py-2">{c.vatRatePct} %</td>
                  <td className="px-3 py-2">{c.isPerAttendee ? 'na návštěvníka' : 'pevný'}</td>
                  <td className="px-3 py-2">{c.dueDate ?? '—'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void togglePaid(c)}
                      disabled={busy}
                      className={c.paid ? 'text-emerald-700' : 'text-muted-foreground hover:underline'}
                    >
                      {c.paid ? 'ano' : 'označit'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.fromAgreement ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void removeCost(c.id)}
                        disabled={busy}
                        className="text-rose-700 hover:underline"
                      >
                        Smazat
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {summary ? (
        <p className="text-xs text-muted-foreground">
          {summary.vatPayer
            ? 'Pořadatel je plátce DPH — do bodu zlomu vstupují částky bez daně.'
            : 'Pořadatel není plátce DPH — do bodu zlomu vstupují částky včetně daně.'}
        </p>
      ) : null}
    </div>
  );
}
