'use client';

/**
 * /admin/scanner/devices — správa hardwarových scannerů (API klíče pro průmyslová zařízení)
 *
 * Promotér registruje fyzická zařízení (Zebra handhelds, NFC čtečky, turnikety)
 * a získá API klíč, který zařízení posílá na POST /api/hardware/scan.
 */

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check, HardDrive } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Device {
  id: string;
  name: string;
  description: string | null;
  apiKey: string;
  eventTitle: string | null;
  gateLabel: string | null;
  zoneName: string | null;
  active: boolean;
  lastSeenAt: string | null;
}

interface NewDeviceResult {
  id: string;
  apiKey: string;
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

export default function ScannerDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
    const res = await authFetch('/api/admin/scanner/devices');
    if (res.ok) {
      const j = (await res.json()) as { devices: Device[] };
      setDevices(j.devices ?? []);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin/scanner/devices', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as NewDeviceResult;
      setNewKey(j.apiKey);
      setName('');
      setDescription('');
      setShowForm(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(d: Device) {
    await authFetch(`/api/admin/scanner/devices/${d.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !d.active }),
    });
    void load();
  }

  async function del(id: string) {
    if (!confirm('Smazat zařízení? API klíč přestane fungovat.')) return;
    await authFetch(`/api/admin/scanner/devices/${id}`, { method: 'DELETE' });
    void load();
  }

  async function copyKey(key: string, id: string) {
    await navigator.clipboard.writeText(key);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hardwarová zařízení"
        description="API klíče pro průmyslové scannery (Zebra, NFC čtečky, turnikety). Každé zařízení dostane unikátní klíč pro endpoint POST /api/hardware/scan."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/scanner" className="text-sm text-primary hover:underline self-center">
              ← Scanner
            </Link>
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus className="mr-2 h-4 w-4" />
              Nové zařízení
            </Button>
          </div>
        }
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      {/* Nový klíč — zobrazit jen jednou po vytvoření */}
      {newKey && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="p-4">
            <div className="mb-2 font-semibold text-emerald-900">✅ Zařízení vytvořeno — zkopírujte API klíč</div>
            <p className="mb-3 text-xs text-emerald-800">
              Tento klíč se zobrazí pouze jednou. Uložte ho ihned do konfigurace zařízení.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-emerald-100 px-2 py-1.5 text-xs font-mono text-emerald-900">
                {newKey}
              </code>
              <button
                type="button"
                onClick={() => { void copyKey(newKey, 'new'); }}
                className="flex-shrink-0 rounded p-1.5 hover:bg-emerald-200"
              >
                {copiedId === 'new' ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4 text-emerald-700" />}
              </button>
            </div>
            <div className="mt-3 rounded bg-emerald-100 p-3 text-xs text-emerald-800 font-mono">
              <div className="font-semibold mb-1">Curl test (terminal):</div>
              {`curl -s -X POST https://app.tixly.cz/api/hardware/scan \\`}<br />
              {`  -H "X-Device-Key: ${newKey}" \\`}<br />
              {`  -H "Content-Type: application/json" \\`}<br />
              {`  -d '{"barcode":"tixly:<ticket-uuid>:<6digit-code>"}'`}
            </div>
            <button type="button" onClick={() => setNewKey(null)} className="mt-3 text-xs text-emerald-700 underline">
              Zavřít
            </button>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Nové zařízení</CardTitle>
            <CardDescription>Pojmenujte zařízení (např. "Vstup A — Zebra TC52").</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void create(e); }} className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Název zařízení *</label>
                <Input
                  placeholder="Vstup A — Zebra TC52"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Popis</label>
                <Input
                  placeholder="Hlavní vstup, hala A, operátor Jan N."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Generuji…' : 'Vytvořit a získat klíč'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Zrušit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* API dokumentace */}
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm">
          <div className="font-semibold mb-2">📡 Integrace hardwarového scanneru</div>
          <p className="text-muted-foreground mb-3">
            Každé zařízení POST na <code className="bg-muted px-1 rounded">/api/hardware/scan</code> s hlavičkou <code className="bg-muted px-1 rounded">X-Device-Key</code>.
            Odpověď obsahuje <code className="bg-muted px-1 rounded">color: &quot;green&quot; | &quot;amber&quot; | &quot;red&quot;</code> pro přímé ovládání LED displeje.
          </p>
          <div className="rounded bg-slate-900 text-slate-100 p-3 text-xs font-mono space-y-1 overflow-x-auto">
            <div><span className="text-slate-400">// Request</span></div>
            <div>{'POST /api/hardware/scan'}</div>
            <div>{'X-Device-Key: tixly_dev_...'}</div>
            <div>{'{ "barcode": "tixly:<uuid>:<6digits>" }'}</div>
            <div className="mt-2"><span className="text-slate-400">// Response (admit)</span></div>
            <div>{'{ "result": "admitted", "color": "green",'}</div>
            <div>{'  "message": "Vstup povolen.", "ticket": {...} }'}</div>
            <div className="mt-2"><span className="text-slate-400">// Response (already used)</span></div>
            <div>{'{ "result": "already_used", "color": "amber", ... }'}</div>
          </div>
        </CardContent>
      </Card>

      {devices.length === 0 && !showForm ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <HardDrive className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Zatím žádná zařízení. Přidejte první Zebra scanner, NFC čtečku nebo turniket.
            </p>
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Přidat zařízení
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {devices.map((d) => (
            <Card key={d.id} className={d.active ? '' : 'opacity-60'}>
              <CardContent className="flex items-start gap-4 p-4">
                <HardDrive className={`mt-0.5 h-5 w-5 flex-shrink-0 ${d.active ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{d.name}</span>
                    {!d.active && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">neaktivní</span>
                    )}
                    {d.eventTitle && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{d.eventTitle}</span>
                    )}
                    {d.gateLabel && (
                      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">Brána: {d.gateLabel}</span>
                    )}
                  </div>
                  {d.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{d.description}</p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <code className="truncate text-xs text-muted-foreground font-mono max-w-[260px]">
                      {d.apiKey.slice(0, 24)}…
                    </code>
                    <button
                      type="button"
                      onClick={() => { void copyKey(d.apiKey, d.id); }}
                      className="rounded p-1 hover:bg-muted"
                      title="Kopírovat API klíč"
                    >
                      {copiedId === d.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                  </div>
                  {d.lastSeenAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Naposledy viděn: {new Date(d.lastSeenAt).toLocaleString('cs-CZ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => { void toggleActive(d); }}
                    className="rounded p-1.5 hover:bg-muted"
                    title={d.active ? 'Deaktivovat' : 'Aktivovat'}
                  >
                    {d.active
                      ? <ToggleRight className="h-5 w-5 text-emerald-600" />
                      : <ToggleLeft className="h-5 w-5 text-slate-400" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void del(d.id); }}
                    className="rounded p-1.5 hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    title="Smazat"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
