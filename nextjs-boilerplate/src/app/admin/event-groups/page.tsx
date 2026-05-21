'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Layers, Calendar, Users, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface EventGroup {
  id: string;
  name: string;
  slug: string;
  groupType: 'tour' | 'festival' | 'series' | 'repeating' | 'cross_venue';
  status: string;
  description: string | null;
  eventCount: number;
  onsaleCoordinatedAt: string | null;
  createdAt: string;
}

const GROUP_TYPE_LABEL: Record<string, { label: string; icon: string }> = {
  tour: { label: 'Tour (turné)', icon: '🚌' },
  festival: { label: 'Festival', icon: '🎪' },
  series: { label: 'Série / cyklus', icon: '🎭' },
  repeating: { label: 'Opakované', icon: '🔁' },
  cross_venue: { label: 'Více míst', icon: '🌍' },
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Koncept', cls: 'bg-gray-100 text-gray-700' },
  active: { label: 'Aktivní', cls: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Dokončené', cls: 'bg-blue-100 text-blue-800' },
  archived: { label: 'Archiv', cls: 'bg-zinc-100 text-zinc-600' },
};

export default function EventGroupsPage() {
  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [groupType, setGroupType] = useState<EventGroup['groupType']>('tour');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await typedGet<{ groups: EventGroup[] }>('/api/admin/event-groups');
      setGroups(data.groups ?? []);
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await typedPost<{ id: string }>(
        '/api/admin/event-groups',
        { name, slug, groupType, description: description || undefined },
        { throwOnError: true },
      );
      setName(''); setSlug(''); setDescription('');
      setShowForm(false);
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string } | undefined;
        setError(body?.error === 'SLUG_TAKEN' ? 'Slug už existuje' : body?.error ?? `HTTP ${err.status}`);
      } else {
        setError('Síťová chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Event Groups"
        description="Sdružení akcí do logických skupin — tour, festival, série, opakované. TM-style multi-event tooling."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{groups.length} skupin celkem</p>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {showForm ? 'Zavřít' : 'Nová skupina'}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Nová Event Group</CardTitle>
            <CardDescription>
              Vyber typ. Po vytvoření můžeš přidávat akce do skupiny + bulk-edit napříč.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Název</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Jaro 2027 Tour" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Slug</label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  required
                  pattern="[a-z0-9-]{2,80}"
                  placeholder="jaro-2027-tour"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Typ skupiny</label>
                <select
                  value={groupType}
                  onChange={(e) => setGroupType(e.target.value as EventGroup['groupType'])}
                  className="block h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {Object.entries(GROUP_TYPE_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>{v.icon} {v.label}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Popis (volitelný)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="block w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={busy || !name || !slug}>
                  {busy ? 'Vytvářím…' : 'Vytvořit skupinu'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Seznam ({groups.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <div className="py-8 text-center">
              <Layers className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Žádné skupiny. Vytvoř první tour / festival / sérii.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {groups.map((g) => {
                const type = GROUP_TYPE_LABEL[g.groupType];
                const status = STATUS_LABEL[g.status] ?? STATUS_LABEL.draft;
                return (
                  <Link
                    key={g.id}
                    href={`/admin/event-groups/${g.id}`}
                    className="rounded-lg border bg-card p-4 transition hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl" aria-hidden>{type?.icon ?? '📦'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold truncate">{g.name}</h3>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${status.cls}`}>
                            {status.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{type?.label}</p>
                        {g.description ? (
                          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                            {g.description}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center gap-4 text-xs">
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Calendar className="h-3 w-3" /> {g.eventCount} akcí
                          </span>
                          {g.onsaleCoordinatedAt ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <Users className="h-3 w-3" /> Onsale synced
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 self-center text-muted-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
