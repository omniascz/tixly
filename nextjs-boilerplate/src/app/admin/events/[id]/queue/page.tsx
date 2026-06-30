'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Users, Timer, ToggleLeft, ToggleRight, ArrowRight, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedFetch, typedPost } from '@/lib/typed-fetch';

interface QueueStats {
  eventId: string;
  eventTitle: string;
  queueEnabled: boolean;
  maxConcurrent: number;
  queueMode: 'fifo' | 'random';
  waiting: number;
  active: number;
  slotsAvailable: number;
  estimatedWaitSeconds: number;
  tokens: {
    id: string;
    email: string;
    status: 'waiting' | 'admitted' | 'completed' | 'expired' | 'cancelled';
    joinedAt: string;
    admittedAt: string | null;
    expiresAt: string | null;
  }[];
}

const STATUS_BADGE: Record<string, string> = {
  waiting:   'bg-amber-100 text-amber-800',
  admitted:  'bg-emerald-100 text-emerald-800',
  completed: 'bg-slate-100 text-slate-600',
  expired:   'bg-rose-100 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  return `~${Math.round(seconds / 60)} min`;
}

export default function QueueAdminPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [stats, setStats]     = useState<QueueStats | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [saved, setSaved]     = useState<string | null>(null);
  const [maxInput, setMaxInput] = useState('');
  const [admitN, setAdmitN]   = useState('10');

  const load = useCallback(async () => {
    try {
      const data = await typedGet<QueueStats>(`/api/admin/events/${eventId}/queue`);
      setStats(data);
      setMaxInput(String(data.maxConcurrent));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  // Auto-refresh every 5s while queue is active
  useEffect(() => {
    if (!stats?.queueEnabled) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [stats?.queueEnabled, load]);

  async function toggleQueue() {
    if (!stats) return;
    setBusy(true); setSaved(null);
    try {
      await typedFetch(`/api/admin/events/${eventId}/queue`, {
        method: 'PATCH',
        body: { queueEnabled: !stats.queueEnabled },
        throwOnError: true,
      });
      setSaved(stats.queueEnabled ? 'Fronta vypnuta.' : 'Fronta zapnuta.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally { setBusy(false); }
  }

  async function saveMode(mode: 'fifo' | 'random') {
    setBusy(true); setSaved(null);
    try {
      await typedFetch(`/api/admin/events/${eventId}/queue`, {
        method: 'PATCH',
        body: { queueMode: mode },
        throwOnError: true,
      });
      setSaved(mode === 'random'
        ? 'Režim fronty: náhodný výběr (čas příchodu nerozhoduje).'
        : 'Režim fronty: dle pořadí příchodu (first-come).');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally { setBusy(false); }
  }

  async function saveMax() {
    const n = Number(maxInput);
    if (!Number.isFinite(n) || n < 1) return;
    setBusy(true); setSaved(null);
    try {
      await typedFetch(`/api/admin/events/${eventId}/queue`, {
        method: 'PATCH',
        body: { maxConcurrent: n },
        throwOnError: true,
      });
      setSaved(`Max souběžných nastaveno na ${n}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally { setBusy(false); }
  }

  async function admitNext() {
    const n = Number(admitN);
    if (!Number.isFinite(n) || n < 1) return;
    setBusy(true); setSaved(null);
    try {
      const r = await typedPost<{ ok: boolean; admitted: number }>(
        `/api/admin/events/${eventId}/queue`,
        { count: n },
      );
      setSaved(`Vpuštěno ${r.admitted} lidí do checkoutu.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally { setBusy(false); }
  }

  if (!stats) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {error ?? 'Načítání…'}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Smart Queue"
        description="Virtuální čekárna pro high-demand prodej vstupenek"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="mr-1 h-3 w-3" /> Obnovit
          </Button>
        }
      />

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-amber-700">
              <Timer className="h-4 w-4" />
              <span className="text-xs font-medium uppercase">Čeká</span>
            </div>
            <p className="mt-1 text-3xl font-bold">{stats.waiting}</p>
            {stats.waiting > 0 && (
              <p className="text-xs text-muted-foreground">ETA: {formatEta(stats.estimatedWaitSeconds)}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <Users className="h-4 w-4" />
              <span className="text-xs font-medium uppercase">Aktivních</span>
            </div>
            <p className="mt-1 text-3xl font-bold">{stats.active}</p>
            <p className="text-xs text-muted-foreground">z max {stats.maxConcurrent}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-blue-700">
              <ArrowRight className="h-4 w-4" />
              <span className="text-xs font-medium uppercase">Volné sloty</span>
            </div>
            <p className="mt-1 text-3xl font-bold">{stats.slotsAvailable}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              {stats.queueEnabled
                ? <ToggleRight className="h-4 w-4 text-emerald-600" />
                : <ToggleLeft className="h-4 w-4 text-slate-400" />}
              <span className="text-xs font-medium uppercase">Fronta</span>
            </div>
            <p className={`mt-1 text-sm font-semibold ${stats.queueEnabled ? 'text-emerald-700' : 'text-slate-500'}`}>
              {stats.queueEnabled ? 'Zapnutá' : 'Vypnutá'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Zapnout / vypnout frontu</CardTitle>
            <CardDescription className="text-xs">
              Když je fronta zapnutá, každý kupující musí čekat na přijetí.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => void toggleQueue()}
              disabled={busy}
              variant={stats.queueEnabled ? 'destructive' : 'default'}
              className="w-full"
            >
              {stats.queueEnabled ? 'Vypnout frontu' : 'Zapnout frontu'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Max souběžných kupujících</CardTitle>
            <CardDescription className="text-xs">
              Kolik lidí může nakupovat naráz. Zbytek čeká ve frontě.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={5000}
              value={maxInput}
              onChange={(e) => setMaxInput(e.target.value)}
              className="w-24"
            />
            <Button onClick={() => void saveMax()} disabled={busy} variant="outline">
              Uložit
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Režim fronty</CardTitle>
            <CardDescription className="text-xs">
              <strong>Náhodný</strong> (AXS Fair AXS): pořadí se losuje — kdo dorazí dřív nemá výhodu,
              anti-bot pro masivní onsale. <strong>Příchodem</strong>: klasické first-come.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button
              onClick={() => void saveMode('fifo')}
              disabled={busy || stats.queueMode === 'fifo'}
              variant={stats.queueMode === 'fifo' ? 'default' : 'outline'}
              className="flex-1"
            >
              Příchodem
            </Button>
            <Button
              onClick={() => void saveMode('random')}
              disabled={busy || stats.queueMode === 'random'}
              variant={stats.queueMode === 'random' ? 'default' : 'outline'}
              className="flex-1"
            >
              Náhodný
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ručně vpustit</CardTitle>
            <CardDescription className="text-xs">
              Okamžitě vpusť N čekajících bez ohledu na kapacitu.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              type="number"
              min={1}
              max={500}
              value={admitN}
              onChange={(e) => setAdmitN(e.target.value)}
              className="w-24"
              placeholder="10"
            />
            <Button onClick={() => void admitNext()} disabled={busy || stats.waiting === 0}>
              Vpustit
            </Button>
          </CardContent>
        </Card>
      </div>

      {saved && <p className="text-sm text-emerald-700">{saved}</p>}
      {error && <p className="text-sm text-rose-700">{error}</p>}

      {/* Token table */}
      {stats.tokens.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Aktuální fronta (max 200)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2 text-left font-medium">Email / ID</th>
                  <th className="px-4 py-2 text-left font-medium">Stav</th>
                  <th className="px-4 py-2 text-left font-medium">Přišel</th>
                  <th className="px-4 py-2 text-left font-medium">Vpuštěn</th>
                  <th className="px-4 py-2 text-left font-medium">Vyprší</th>
                </tr>
              </thead>
              <tbody>
                {stats.tokens.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono text-xs">{t.email}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[t.status] ?? ''}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(t.joinedAt).toLocaleTimeString('cs-CZ')}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {t.admittedAt ? new Date(t.admittedAt).toLocaleTimeString('cs-CZ') : '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {t.expiresAt ? new Date(t.expiresAt).toLocaleTimeString('cs-CZ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {stats.tokens.length === 0 && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Fronta je prázdná.
        </div>
      )}
    </div>
  );
}
