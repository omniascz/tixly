'use client';

import { useEffect, useState, use } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

interface TicketType {
  id: string;
  name: string;
}

interface TableSummary {
  totalSeats: number;
  tableCount: number;
  seatsPerTable: number;
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

export default function TableSeatingPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = use(props.params);
  const { id: eventId } = useRouteParams(params);

  const [summary, setSummary] = useState<TableSummary | null>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [tableCount, setTableCount] = useState(10);
  const [seatsPerTable, setSeatsPerTable] = useState(8);
  const [shape, setShape] = useState<'round' | 'square'>('round');
  const [ticketTypeId, setTicketTypeId] = useState('');

  useEffect(() => {
    void loadSummary();
    void loadTicketTypes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function loadSummary(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/table-seating`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as TableSummary;
      setSummary(j);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadTicketTypes(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/ticket-types`);
      if (!res.ok) return;
      const j = (await res.json()) as { ticketTypes?: TicketType[] };
      setTicketTypes(j.ticketTypes ?? []);
    } catch {
      // ignore — ticket types are optional
    }
  }

  async function generate(): Promise<void> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/table-seating`, {
        method: 'POST',
        body: JSON.stringify({
          tableCount,
          seatsPerTable,
          shape,
          ticketTypeId: ticketTypeId || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        totalSeats?: number;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(
        `Rozložení vygenerováno: ${tableCount} stolů × ${seatsPerTable} míst = ${j.totalSeats ?? tableCount * seatsPerTable} míst.`,
      );
      await loadSummary();
    } finally {
      setBusy(false);
    }
  }

  async function deleteLayout(): Promise<void> {
    if (!confirm(`Opravdu smazat celé stolové rozložení (${summary?.totalSeats ?? 0} míst)?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/table-seating`, {
        method: 'DELETE',
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; deleted?: number; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(`Smazáno ${j.deleted ?? 0} míst.`);
      await loadSummary();
    } finally {
      setBusy(false);
    }
  }

  const hasTables = (summary?.tableCount ?? 0) > 0;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Stolové rozložení"
        description="Automatické generování míst u stolů pro plesy, galavečery, konference a restaurační seating. Stoly se vytvoří jako sektory 'Stůl 1', 'Stůl 2', …"
      />

      {/* Current layout summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Aktuální rozložení</CardTitle>
        </CardHeader>
        <CardContent>
          {hasTables ? (
            <div className="flex items-center gap-4">
              <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
                <div className="text-2xl font-bold tabular-nums">{summary?.tableCount}</div>
                <div className="text-xs text-muted-foreground">stolů</div>
              </div>
              <div className="text-2xl text-muted-foreground">×</div>
              <div className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
                <div className="text-2xl font-bold tabular-nums">{summary?.seatsPerTable}</div>
                <div className="text-xs text-muted-foreground">míst / stůl</div>
              </div>
              <div className="text-2xl text-muted-foreground">=</div>
              <div className="rounded-lg border bg-primary/10 px-4 py-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-primary">{summary?.totalSeats}</div>
                <div className="text-xs text-muted-foreground">míst celkem</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Žádné stolové rozložení zatím neexistuje. Vyplňte formulář níže a klikněte na Generovat.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Generator form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Generátor rozložení</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Počet stolů (1–200)</label>
              <Input
                type="number"
                min={1}
                max={200}
                value={tableCount}
                onChange={(e) => setTableCount(Math.max(1, Math.min(200, Number(e.target.value))))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Míst u stolu (1–20)</label>
              <Input
                type="number"
                min={1}
                max={20}
                value={seatsPerTable}
                onChange={(e) => setSeatsPerTable(Math.max(1, Math.min(20, Number(e.target.value))))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Tvar stolu</label>
              <select
                value={shape}
                onChange={(e) => setShape(e.target.value as 'round' | 'square')}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="round">Kulatý</option>
                <option value="square">Čtvercový / obdélníkový</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Typ vstupenky (volitelné)</label>
              <select
                value={ticketTypeId}
                onChange={(e) => setTicketTypeId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— žádný —</option>
                {ticketTypes.map((tt) => (
                  <option key={tt.id} value={tt.id}>
                    {tt.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Vygeneruje se <strong>{tableCount * seatsPerTable} míst</strong> ({tableCount} stolů × {seatsPerTable} míst).
            {hasTables ? ' Stávající stolové rozložení bude nahrazeno.' : ''}
          </div>

          <div className="flex gap-3">
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Generuji…' : 'Generovat rozložení'}
            </Button>
            {hasTables ? (
              <Button variant="destructive" onClick={deleteLayout} disabled={busy}>
                Smazat rozložení
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      {hasTables ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Stoly</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {Array.from({ length: summary?.tableCount ?? 0 }, (_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center justify-center rounded-lg border bg-card p-3 text-center shadow-sm"
                >
                  <div className="text-lg">
                    {shape === 'round' ? '⭕' : '⬜'}
                  </div>
                  <div className="mt-1 text-xs font-medium">Stůl {i + 1}</div>
                  <div className="text-[10px] text-muted-foreground">{summary?.seatsPerTable} míst</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
