'use client';

import { useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { FolderHeart, Plus, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Collection {
  id: string; promoter_id: string | null;
  slug: string; title: string; subtitle: string | null;
  description: string | null; cover_image_url: string | null;
  display_style: string; is_public: boolean; is_featured: boolean;
  event_count: number;
}

export default function CollectionsPage(): JSX.Element {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [displayStyle, setDisplayStyle] = useState('grid');
  const [isPublic, setIsPublic] = useState(true);

  useEffect(() => { void load(); }, []);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ collections: Collection[] }>('/api/admin/collections');
      setCollections(r.collections ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost('/api/admin/collections', {
        slug, title,
        subtitle: subtitle || undefined,
        description: description || undefined,
        coverImageUrl: coverUrl || undefined,
        displayStyle, isPublic,
      }, { throwOnError: true });
      setShowForm(false);
      setSlug(''); setTitle(''); setSubtitle(''); setDescription(''); setCoverUrl('');
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Event Collections"
        description="Eventbrite-style curated lists. Vytvoř kolekci 'Nejlepší koncerty léta' a embedni na partner web."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{collections.length} kolekcí</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nová kolekce'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nová kolekce</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Slug *</label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="leto-2026" maxLength={80} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Display style</label>
                <select value={displayStyle} onChange={(e) => setDisplayStyle(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="grid">Grid</option>
                  <option value="list">List</option>
                  <option value="carousel">Carousel</option>
                  <option value="masonry">Masonry</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Titulek *</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Nejlepší koncerty léta 2026" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Podtitulek</label>
              <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={300} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} maxLength={2000}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Cover image URL</label>
              <Input type="url" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Veřejná (přístupná na /collections/[slug])
            </label>
            <Button onClick={create} disabled={busy || !slug || !title}>
              <Plus className="mr-1 h-4 w-4" /> {busy ? 'Ukládám…' : 'Vytvořit'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {collections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <FolderHeart className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné kolekce. Vytvoř první a postupně do ní přidávej akce.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {collections.map((c) => (
            <Card key={c.id}>
              {c.cover_image_url ? (
                <div className="aspect-video bg-muted">
                  <img src={c.cover_image_url} alt={c.title} className="h-full w-full object-cover" />
                </div>
              ) : null}
              <CardContent className="pt-4">
                <p className="font-semibold">{c.title}</p>
                {c.subtitle ? <p className="text-sm text-muted-foreground">{c.subtitle}</p> : null}
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {c.event_count} akcí · /{c.slug}
                  </p>
                  {c.is_public ? (
                    <Link href={`/cs/collections/${c.slug}`} target="_blank"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      Náhled <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
