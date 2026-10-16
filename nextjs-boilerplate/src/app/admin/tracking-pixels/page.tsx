'use client';

import { useEffect, useState, type JSX } from 'react';
import { Tag, Plus, Trash2, Power, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ALL_PIXEL_TYPES, PIXEL_CATEGORIES, type PixelTypeDef } from '@/lib/tracking/pixel-registry';

interface Pixel {
  id: string;
  event_id: string | null;
  platform: string;
  pixel_id: string;
  pixel_name: string | null;
  events_tracked: string[];
  is_active: boolean;
  config: Record<string, string> | null;
  created_at: string;
}

const authFetch = (url: string, opts?: RequestInit) =>
  fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${typeof localStorage !== 'undefined' ? (localStorage.getItem('accessToken') ?? '') : ''}`,
      ...(opts?.headers ?? {}),
    },
  });

const EVENTS_OPTIONS = [
  { value: 'ViewContent', label: 'Zobrazení akce' },
  { value: 'InitiateCheckout', label: 'Zahájení objednávky' },
  { value: 'Purchase', label: 'Nákup (konverze)' },
];

export default function TrackingPixelsPage(): JSX.Element {
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  // Form state
  const [selectedType, setSelectedType] = useState<PixelTypeDef | null>(null);
  const [pixelId, setPixelId] = useState('');
  const [pixelName, setPixelName] = useState('');
  const [scope, setScope] = useState<'all' | 'event'>('all');
  const [eventId, setEventId] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['ViewContent', 'InitiateCheckout', 'Purchase']);
  const [extraConfig, setExtraConfig] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      const r = await authFetch('/api/admin/tracking-pixels');
      const d = await r.json() as { pixels?: Pixel[] };
      setPixels(d.pixels ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setLoading(false);
    }
  }

  function selectType(pt: PixelTypeDef): void {
    setSelectedType(pt);
    setExtraConfig({});
    setSelectedEvents(pt.defaultEvents);
    setPixelId('');
    setPixelName('');
  }

  async function create(): Promise<void> {
    if (!selectedType || !pixelId.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await authFetch('/api/admin/tracking-pixels', {
        method: 'POST',
        body: JSON.stringify({
          platform: selectedType.id,
          pixelId: pixelId.trim(),
          pixelName: pixelName.trim() || undefined,
          config: Object.keys(extraConfig).length > 0 ? extraConfig : undefined,
          eventId: scope === 'event' && eventId.trim() ? eventId.trim() : null,
          eventsTracked: selectedEvents,
        }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setShowForm(false);
      setSelectedType(null);
      setPixelId('');
      setPixelName('');
      setEventId('');
      setExtraConfig({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(pixel: Pixel): Promise<void> {
    await authFetch(`/api/admin/tracking-pixels/${pixel.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !pixel.is_active }),
    });
    await load();
  }

  async function deletePixel(id: string): Promise<void> {
    if (!confirm('Smazat pixel?')) return;
    await authFetch(`/api/admin/tracking-pixels/${id}`, { method: 'DELETE' });
    await load();
  }

  const grouped = ALL_PIXEL_TYPES.reduce<Record<string, PixelTypeDef[]>>((acc, pt) => {
    (acc[pt.category] ??= []).push(pt);
    return acc;
  }, {});

  const filteredTypes = search.trim()
    ? ALL_PIXEL_TYPES.filter((pt) => pt.name.toLowerCase().includes(search.toLowerCase()))
    : null;

  const activeCount = pixels.filter((p) => p.is_active).length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Tracking Pixely"
        description={`${ALL_PIXEL_TYPES.length} podporovaných platforem — Meta, Google Ads, TikTok, Snapchat, LinkedIn, Pinterest a desítky dalších.`}
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {pixels.length} pixelů · {activeCount} aktivních
        </p>
        <Button onClick={() => { setShowForm(!showForm); setSelectedType(null); }}>
          <Plus className="mr-1 h-4 w-4" /> Nový pixel
        </Button>
      </div>

      {/* ── Formulář ── */}
      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Přidat tracking pixel</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!selectedType ? (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Hledat platformu…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {(filteredTypes ? [{ key: 'search', label: 'Výsledky', types: filteredTypes }] :
                  Object.entries(grouped).map(([key, types]) => ({
                    key, label: PIXEL_CATEGORIES[key] ?? key, types,
                  }))
                ).map(({ key, label, types }) => (
                  <div key={key}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {label}
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {types.map((pt) => (
                        <button
                          key={pt.id}
                          onClick={() => selectType(pt)}
                          className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          <span className="text-base">{pt.icon}</span>
                          <span className="truncate">{pt.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedType(null)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Zpět
                  </button>
                  <span className="text-sm font-medium">
                    {selectedType.icon} {selectedType.name}
                  </span>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium">
                    {selectedType.id === 'custom_script' ? 'Název (popis) *' : 'Pixel ID *'}
                  </label>
                  <Input
                    value={pixelId}
                    onChange={(e) => setPixelId(e.target.value)}
                    placeholder={selectedType.placeholder}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium">Pojmenování (volitelné)</label>
                  <Input
                    value={pixelName}
                    onChange={(e) => setPixelName(e.target.value)}
                    placeholder="Např. Hlavní pixel, Retargeting Q4…"
                  />
                </div>

                {selectedType.configFields.map((f) => (
                  <div key={f.key}>
                    <label className="mb-1 block text-xs font-medium">
                      {f.label} {f.required ? '*' : ''}
                    </label>
                    {f.type === 'textarea' ? (
                      <textarea
                        rows={6}
                        className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                        placeholder={f.placeholder}
                        value={extraConfig[f.key] ?? ''}
                        onChange={(e) => setExtraConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        type={f.type === 'password' ? 'password' : 'text'}
                        placeholder={f.placeholder}
                        value={extraConfig[f.key] ?? ''}
                        onChange={(e) => setExtraConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                      />
                    )}
                    {f.hint ? <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p> : null}
                  </div>
                ))}

                <div>
                  <label className="mb-1 block text-xs font-medium">Eventy k zachycení</label>
                  <div className="flex flex-wrap gap-2">
                    {EVENTS_OPTIONS.map((ev) => (
                      <label key={ev.value} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(ev.value)}
                          onChange={(e) =>
                            setSelectedEvents((prev) =>
                              e.target.checked
                                ? [...prev, ev.value]
                                : prev.filter((x) => x !== ev.value),
                            )
                          }
                        />
                        {ev.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium">Rozsah</label>
                  <div className="space-y-1">
                    {(['all', 'event'] as const).map((s) => (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <input type="radio" checked={scope === s} onChange={() => setScope(s)} />
                        <span>{s === 'all' ? 'Všechny akce (promoter-wide)' : 'Jen konkrétní akce'}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {scope === 'event' ? (
                  <div>
                    <label className="mb-1 block text-xs font-medium">Event ID (UUID)</label>
                    <Input
                      value={eventId}
                      onChange={(e) => setEventId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    />
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button
                    onClick={create}
                    disabled={busy || !pixelId.trim() || selectedEvents.length === 0}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    {busy ? 'Ukládám…' : 'Aktivovat pixel'}
                  </Button>
                  <Button variant="outline" onClick={() => { setShowForm(false); setSelectedType(null); }}>
                    Zrušit
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Seznam pixelů ── */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : pixels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Tag className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné pixely. Přidej Meta Pixel, TikTok, Google Ads nebo libovolnou z{' '}
              {ALL_PIXEL_TYPES.length} podporovaných platforem.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pixels.map((p) => {
            const typeDef = ALL_PIXEL_TYPES.find((x) => x.id === p.platform);
            const expanded = expandedId === p.id;
            return (
              <Card key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{typeDef?.icon ?? '🔧'}</span>
                        <p className="font-semibold truncate">
                          {p.pixel_name ?? typeDef?.name ?? p.platform}
                        </p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                          p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {p.is_active ? 'Aktivní' : 'Pozastaven'}
                        </span>
                      </div>
                      <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate">
                        {p.pixel_id.length > 60 ? `${p.pixel_id.slice(0, 60)}…` : p.pixel_id}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.event_id ? `Akce: ${p.event_id.slice(0, 8)}…` : '🌍 Všechny akce'}
                        {' · '}
                        {p.events_tracked.join(', ')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => setExpandedId(expanded ? null : p.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                        title="Detail"
                      >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => void toggleActive(p)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent"
                        title={p.is_active ? 'Pozastavit' : 'Aktivovat'}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void deletePixel(p.id)}
                        className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                        title="Smazat"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs space-y-1">
                      <p><span className="font-medium">Platforma:</span> {typeDef?.name ?? p.platform}</p>
                      <p><span className="font-medium">ID:</span> <code className="font-mono">{p.pixel_id}</code></p>
                      <p><span className="font-medium">Eventy:</span> {p.events_tracked.join(', ')}</p>
                      <p><span className="font-medium">Rozsah:</span> {p.event_id ? `Event ${p.event_id}` : 'Promotér-wide'}</p>
                      <p><span className="font-medium">Server-side:</span> {typeDef?.hasServerSide ? '✅ CAPI/Conversions API' : '❌ jen client-side'}</p>
                      <p><span className="font-medium">Přidán:</span> {new Date(p.created_at).toLocaleDateString('cs-CZ')}</p>
                      {p.config && Object.keys(p.config).length > 0 ? (
                        <p><span className="font-medium">Konfig:</span>{' '}
                          {Object.entries(p.config).map(([k]) => k).join(', ')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="rounded-md border border-blue-200 bg-blue-50/30 p-4 text-sm text-blue-900">
        <p className="font-semibold">GDPR & souhlas</p>
        <p className="mt-1 text-xs text-blue-800">
          Pixely se spouštějí jen po udělení souhlasu s marketing cookies. Meta, TikTok a GA4
          navíc odesílají server-side konverze (CAPI) pro přesnější atribuci i bez cookies.
          {ALL_PIXEL_TYPES.filter((p) => p.hasServerSide).map((p) => p.name).join(', ')} mají server-side podporu.
        </p>
      </div>
    </div>
  );
}
