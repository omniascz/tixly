'use client';

import { useState } from 'react';
import { Users, ScanLine, Camera, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { QrScannerCamera } from '@/components/admin/QrScannerCamera';

interface GroupTicket {
  id: string;
  label: string;
  status: string;
}
interface GroupResult {
  result: 'ok' | 'expired' | 'invalid' | 'not_found';
  message?: string;
  counts?: { total: number; valid: number; used: number; other: number };
  admittedCount?: number;
  tickets?: GroupTicket[];
}

export function GroupScanPanel() {
  const [token, setToken] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [data, setData] = useState<GroupResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [justAdmitted, setJustAdmitted] = useState<number | null>(null);

  async function call(body: Record<string, unknown>): Promise<GroupResult> {
    const auth = localStorage.getItem('accessToken');
    const res = await fetch('/api/admin/scanner/validate-group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ result: 'invalid' }))) as GroupResult;
  }

  async function loadGroup() {
    const t = token.trim();
    if (!t) return;
    setLoading(true);
    setJustAdmitted(null);
    try {
      const r = await call({ orderToken: t });
      setData(r);
      // defaultně zaškrtni všechny volné
      setSelected(new Set((r.tickets ?? []).filter((x) => x.status === 'valid').map((x) => x.id)));
    } finally {
      setLoading(false);
    }
  }

  async function admit(mode: 'selected' | 'all') {
    const t = token.trim();
    if (!t) return;
    setLoading(true);
    try {
      const body = mode === 'all'
        ? { orderToken: t, admitAll: true }
        : { orderToken: t, admitTicketIds: [...selected] };
      const r = await call(body);
      setData(r);
      setJustAdmitted(r.admittedCount ?? 0);
      setSelected(new Set((r.tickets ?? []).filter((x) => x.status === 'valid').map((x) => x.id)));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setToken(''); setData(null); setSelected(new Set()); setJustAdmitted(null);
  }

  const validTickets = (data?.tickets ?? []).filter((t) => t.status === 'valid');
  const ok = data?.result === 'ok';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" aria-hidden /> Skupinové odbavení (1 QR = celá objednávka)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sken / vstup tokenu */}
        <div className="flex gap-2">
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Naskenuj skupinový QR (nebo vlož token)"
            data-testid="group-token-input"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={() => setCameraOpen(true)} title="Kamera">
            <Camera className="h-4 w-4" aria-hidden />
          </Button>
          <Button type="button" onClick={() => void loadGroup()} disabled={loading || !token.trim()}>
            <ScanLine className="mr-1 h-4 w-4" aria-hidden /> Načíst
          </Button>
        </div>

        {/* Chybové stavy */}
        {data && !ok ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            {data.result === 'expired' ? 'Skupinový QR vypršel — host musí obnovit kód v appce.'
              : data.result === 'not_found' ? 'Objednávka nepatří k vaší akci.'
              : 'Neplatný skupinový QR.'}
          </div>
        ) : null}

        {/* Úspěšné odbavení banner */}
        {justAdmitted !== null ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
            <CheckCircle2 className="h-5 w-5" /> Vpuštěno {justAdmitted} {plur(justAdmitted)}.
          </div>
        ) : null}

        {/* Preview skupiny */}
        {ok && data?.counts ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="emerald">{data.counts.valid} volných</Badge>
              <Badge tone="slate">{data.counts.used} použitých</Badge>
              <Badge tone="muted">{data.counts.total} celkem</Badge>
            </div>

            <ul className="divide-y rounded-md border" data-testid="group-ticket-list">
              {(data.tickets ?? []).map((t) => {
                const isValid = t.status === 'valid';
                return (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      disabled={!isValid}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(t.id); else next.delete(t.id);
                        setSelected(next);
                      }}
                      className="h-4 w-4"
                    />
                    <span className={isValid ? '' : 'text-muted-foreground line-through'}>{t.label}</span>
                    <span className="ml-auto text-xs">
                      {isValid ? <span className="text-emerald-700">volný</span> : <span className="text-muted-foreground">{t.status === 'used' ? 'použitý' : t.status}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>

            {validTickets.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void admit('selected')} disabled={loading || selected.size === 0} data-testid="admit-selected">
                  Pustit vybrané ({selected.size})
                </Button>
                <Button variant="outline" onClick={() => void admit('all')} disabled={loading} data-testid="admit-all">
                  Pustit všechny volné ({validTickets.length})
                </Button>
                <Button variant="ghost" onClick={reset} disabled={loading}>Nová skupina</Button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Všichni z této objednávky už jsou uvnitř.</span>
                <Button size="sm" variant="ghost" onClick={reset}>Nová skupina</Button>
              </div>
            )}
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Host ukáže jeden QR za celou objednávku. Pustíš všechny najednou, nebo odškrtni ty,
          co ještě nedorazili — pozdní příchozí pustíš později dalším skenem.
        </p>
      </CardContent>

      <QrScannerCamera
        open={cameraOpen}
        onDetected={(raw) => { setToken(raw.trim()); setCameraOpen(false); void 0; }}
        onClose={() => setCameraOpen(false)}
      />
    </Card>
  );
}

function Badge({ tone, children }: { tone: 'emerald' | 'slate' | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'emerald' ? 'bg-emerald-100 text-emerald-800'
    : tone === 'slate' ? 'bg-slate-100 text-slate-700' : 'bg-muted text-muted-foreground';
  return <span className={`rounded-full px-3 py-1 font-medium ${cls}`}>{children}</span>;
}

function plur(n: number): string {
  if (n === 1) return 'host';
  if (n >= 2 && n <= 4) return 'hosté';
  return 'hostů';
}
