'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { Wallet, Plus, Trash2, MapPin, Car, Cloud, Music, Pizza, Shirt, Train, Info } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface Module {
  id: string; event_id: string; module_type: string;
  title: string; content: string | null; link_url: string | null;
  icon: string | null; publish_at: string; expires_at: string | null;
  is_active: boolean; display_order: number;
}

const MODULE_TYPES = [
  { value: 'apple_music_playlist', label: 'Apple Music playlist', icon: Music },
  { value: 'venue_map', label: 'Mapa venue', icon: MapPin },
  { value: 'parking_info', label: 'Parking info', icon: Car },
  { value: 'weather_link', label: 'Počasí', icon: Cloud },
  { value: 'merch_link', label: 'Merch shop', icon: Shirt },
  { value: 'gate_instructions', label: 'Pokyny u brány', icon: Info },
  { value: 'food_menu', label: 'Jídlo / F&B', icon: Pizza },
  { value: 'transportation', label: 'Doprava', icon: Train },
  { value: 'before_event_info', label: 'Před akcí', icon: Info },
  { value: 'after_event_info', label: 'Po akci', icon: Info },
  { value: 'custom', label: 'Custom', icon: Info },
] as const;

export default function WalletModulesPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [modules, setModules] = useState<Module[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [moduleType, setModuleType] = useState('venue_map');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  useEffect(() => { void load(); }, [eventId]);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ modules: Module[] }>(`/api/admin/events/${eventId}/wallet-modules`);
      setModules(r.modules ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost(`/api/admin/events/${eventId}/wallet-modules`, {
        moduleType, title,
        content: content || undefined,
        linkUrl: linkUrl || undefined,
      }, { throwOnError: true });
      setShowForm(false);
      setTitle(''); setContent(''); setLinkUrl('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(moduleId: string): Promise<void> {
    if (!confirm('Smazat module?')) return;
    try {
      await typedFetch(`/api/admin/events/${eventId}/wallet-modules?moduleId=${moduleId}`, {
        method: 'DELETE', throwOnError: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Enhanced Wallet Content"
        description="TM Enhanced Wallet 2025 parita. Apple Music, mapa, parking, počasí, merch — na lock-screen pass."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{modules.length} modulů</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nový modul'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nový obsahový modul</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-2 block text-xs font-medium">Typ</label>
              <div className="grid grid-cols-3 gap-2">
                {MODULE_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button type="button" key={t.value} onClick={() => setModuleType(t.value)}
                      className={`flex flex-col items-center gap-1 rounded-md border p-3 text-xs ${
                        moduleType === t.value ? 'border-primary bg-primary/10' : ''
                      }`}>
                      <Icon className="h-4 w-4" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Titulek</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="např. Mapa parkoviště" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis / obsah</label>
              <textarea value={content} onChange={(e) => setContent(e.target.value)}
                rows={3} maxLength={2000}
                placeholder="Krátký text na lock-screenu"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Link URL (kliknutí v Wallet)</label>
              <Input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..." />
            </div>
            <Button onClick={create} disabled={busy || !title}>
              <Plus className="mr-1 h-4 w-4" /> {busy ? 'Ukládám…' : 'Přidat modul'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {modules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Wallet className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné moduly. Tixly publikuje Wallet pass 3 dny před akcí — moduly se objeví na lock-screenu.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {modules.map((m) => {
            const typeInfo = MODULE_TYPES.find((t) => t.value === m.module_type);
            const Icon = typeInfo?.icon ?? Info;
            return (
              <Card key={m.id}>
                <CardContent className="flex items-start gap-3 pt-4">
                  <Icon className="h-5 w-5 flex-shrink-0 text-primary" />
                  <div className="flex-1">
                    <p className="font-semibold">{m.title}</p>
                    {m.content ? <p className="mt-1 text-sm text-muted-foreground">{m.content}</p> : null}
                    {m.link_url ? (
                      <a href={m.link_url} target="_blank" rel="noreferrer"
                        className="mt-1 text-xs text-primary hover:underline">
                        🔗 {m.link_url}
                      </a>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {typeInfo?.label ?? m.module_type}
                    </p>
                  </div>
                  <button type="button" onClick={() => remove(m.id)}
                    className="text-rose-600 hover:text-rose-800"><Trash2 className="h-4 w-4" /></button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
