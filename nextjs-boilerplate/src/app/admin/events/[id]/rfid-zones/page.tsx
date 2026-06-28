'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function authFetch(url: string, init?: RequestInit) {
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

interface Zone {
  id: string; name: string; code: string; capacity: number | null;
  anti_passback: boolean; sort_order: number; current_occupancy: number;
  allowed_ticket_type_ids: string[] | null;
}

interface Device {
  id: string; name: string; zone_id: string | null; zone_name: string | null;
  direction: string; api_key: string; active: boolean; last_seen_at: string | null;
}

const DIR_LABELS: Record<string, string> = { in: '→ Vstup', out: '← Výstup', both: '↔ Obousměrný' };

export default function RfidZonesPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [zones, setZones] = useState<Zone[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [tab, setTab] = useState<'zones' | 'devices'>('zones');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  // Zone form
  const [zName, setZName] = useState('');
  const [zCode, setZCode] = useState('');
  const [zCap, setZCap] = useState('');
  const [zAntiPB, setZAntiPB] = useState(true);

  // Device form
  const [dName, setDName] = useState('');
  const [dZone, setDZone] = useState('');
  const [dDir, setDDir] = useState<'in' | 'out' | 'both'>('in');

  const load = useCallback(async () => {
    const [zr, dr] = await Promise.all([
      authFetch(`/api/admin/events/${eventId}/rfid/zones`).then(r => r.json()),
      authFetch(`/api/admin/events/${eventId}/rfid/devices`).then(r => r.json()),
    ]);
    setZones((zr as { zones: Zone[] }).zones ?? []);
    setDevices((dr as { devices: Device[] }).devices ?? []);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function createZone() {
    setBusy(true); setError(null); setFeedback(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/rfid/zones`, {
        method: 'POST',
        body: JSON.stringify({
          name: zName, code: zCode.toUpperCase(),
          capacity: zCap ? parseInt(zCap, 10) : null,
          antiPassback: zAntiPB,
        }),
      });
      const j = await r.json() as { error?: string };
      if (!r.ok) { setError(j.error ?? 'Chyba'); return; }
      setFeedback('Zóna vytvořena.');
      setZName(''); setZCode(''); setZCap('');
      await load();
    } finally { setBusy(false); }
  }

  async function deleteZone(id: string) {
    if (!confirm('Smazat zónu? Smažou se i log záznamy.')) return;
    await authFetch(`/api/admin/events/${eventId}/rfid/zones/${id}`, { method: 'DELETE' });
    await load();
  }

  async function createDevice() {
    setBusy(true); setError(null); setFeedback(null); setNewKey(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/rfid/devices`, {
        method: 'POST',
        body: JSON.stringify({ name: dName, zoneId: dZone || null, direction: dDir }),
      });
      const j = await r.json() as { api_key?: string; error?: string };
      if (!r.ok) { setError(j.error ?? 'Chyba'); return; }
      setNewKey(j.api_key ?? null);
      setFeedback('Zařízení vytvořeno. API klíč se zobrazí pouze nyní!');
      setDName(''); setDZone('');
      await load();
    } finally { setBusy(false); }
  }

  async function toggleDevice(id: string, active: boolean) {
    await authFetch(`/api/admin/events/${eventId}/rfid/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !active }),
    });
    await load();
  }

  async function deleteDevice(id: string) {
    if (!confirm('Smazat zařízení?')) return;
    await authFetch(`/api/admin/events/${eventId}/rfid/devices/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID Presence — Zóny & Zařízení"
        description="TM Presence style: definuj přístupové zóny, přiřaď RFID čtečky, sleduj obsazenost."
      />

      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {(['zones', 'devices'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
            {t === 'zones' ? '🏟️ Zóny' : '📡 Zařízení'}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>}
      {feedback && <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div>}
      {newKey && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900 mb-1">🔑 API klíč zařízení (zkopíruj teď — nezobrazí se znovu):</p>
          <code className="block text-xs font-mono bg-amber-100 p-2 rounded select-all break-all">{newKey}</code>
          <p className="text-xs text-amber-700 mt-1">Nastav na čtečce jako: <code>X-Device-Key: {newKey}</code></p>
        </div>
      )}

      {/* ── ZÓNY ── */}
      {tab === 'zones' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Přidat zónu</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Název</label>
                  <Input value={zName} onChange={e => setZName(e.target.value)} placeholder="General Admission" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Kód</label>
                  <Input value={zCode} onChange={e => setZCode(e.target.value.toUpperCase())} placeholder="GA" maxLength={10} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Kapacita (prázdné = neomezeno)</label>
                <Input type="number" min={1} value={zCap} onChange={e => setZCap(e.target.value)} placeholder="5000" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={zAntiPB} onChange={e => setZAntiPB(e.target.checked)} className="rounded" />
                Anti-passback (nelze vstoupit dvakrát bez výstupu)
              </label>
              <Button onClick={createZone} disabled={busy || !zName || !zCode} className="w-full">
                Vytvořit zónu
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Zóny akce ({zones.length})</CardTitle></CardHeader>
            <CardContent>
              {zones.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné zóny. Přidej první vpravo.</p>
              ) : (
                <ul className="space-y-2">
                  {zones.map(z => (
                    <li key={z.id} className="flex items-center gap-3 rounded-md border p-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold text-primary">{z.code}</span>
                          <span className="font-medium text-sm">{z.name}</span>
                          {z.anti_passback && <span className="text-[10px] text-muted-foreground">🔒 APB</span>}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Obsazeno: <strong className={z.capacity && z.current_occupancy >= z.capacity ? 'text-destructive' : 'text-emerald-700'}>{z.current_occupancy}</strong>
                          {z.capacity ? ` / ${z.capacity}` : ' (∞)'}
                        </div>
                        {z.capacity && (
                          <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-1 rounded-full bg-primary transition-all"
                              style={{ width: `${Math.min(100, (z.current_occupancy / z.capacity) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                      <button onClick={() => deleteZone(z.id)} className="text-xs text-muted-foreground hover:text-destructive">✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── ZAŘÍZENÍ ── */}
      {tab === 'devices' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Přidat RFID čtečku</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Název</label>
                <Input value={dName} onChange={e => setDName(e.target.value)} placeholder="Turniket Vstup A" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Zóna</label>
                <select value={dZone} onChange={e => setDZone(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— bez přiřazení —</option>
                  {zones.map(z => <option key={z.id} value={z.id}>{z.code} — {z.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">Směr</label>
                <select value={dDir} onChange={e => setDDir(e.target.value as 'in' | 'out' | 'both')}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {Object.entries(DIR_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <Button onClick={createDevice} disabled={busy || !dName} className="w-full">
                Vytvořit zařízení + API klíč
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Zařízení ({devices.length})</CardTitle></CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Žádná zařízení. Přidej vpravo.</p>
              ) : (
                <ul className="space-y-2">
                  {devices.map(d => (
                    <li key={d.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{d.name}</span>
                        <div className="flex gap-2">
                          <button onClick={() => toggleDevice(d.id, d.active)}
                            className={`text-xs px-2 py-0.5 rounded ${d.active ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-muted-foreground'}`}>
                            {d.active ? 'Aktivní' : 'Neaktivní'}
                          </button>
                          <button onClick={() => deleteDevice(d.id)} className="text-xs text-muted-foreground hover:text-destructive">✕</button>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Zóna: {d.zone_name ?? '—'} · {DIR_LABELS[d.direction]}</div>
                        {d.last_seen_at && (
                          <div>Naposledy: {new Date(d.last_seen_at).toLocaleString('cs-CZ')}</div>
                        )}
                        <div className="mt-1 font-mono text-[10px] bg-muted/50 px-1.5 py-0.5 rounded break-all">
                          {d.api_key.slice(0, 28)}…
                          <button onClick={() => void navigator.clipboard.writeText(d.api_key)}
                            className="ml-2 text-primary hover:underline">kopírovat</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <strong>Integrace RFID čtečky:</strong> nastav endpoint <code>POST /api/rfid/scan</code> s hlavičkou
        <code> X-Device-Key: tixly_rfid_...</code> a tělem <code>{`{ "uid": "04A12B..." }`}</code>.
        Vrátí <code>color: green|amber|red</code> pro LED displeje turniketů.
      </div>
    </div>
  );
}
