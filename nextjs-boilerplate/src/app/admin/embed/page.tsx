'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

export default function PromoterEmbedPage() {
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(12);
  const [copied, setCopied] = useState<string | null>(null);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';

  useEffect(() => {
    void (async () => {
      const res = await authFetch('/api/admin/settings');
      if (res.ok) {
        const j = (await res.json()) as { promoter?: { slug?: string | null } };
        setSlug(j.promoter?.slug ?? null);
      }
      setLoading(false);
    })();
  }, []);

  function copy(text: string, key: string): void {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;

  if (!slug) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Embed — všechny tvé akce" description="Vlož na svůj web seznam všech svých akcí." />
        <Card>
          <CardContent className="p-4 text-sm text-amber-900">
            ⚠️ Tvůj profil zatím nemá veřejný odkaz (slug). Doplň ho v <a href="/admin/settings" className="underline">Nastavení</a> a vrať se sem.
          </CardContent>
        </Card>
      </div>
    );
  }

  const htmlSnippet = `<div data-tixly-promoter="${slug}" data-limit="${limit}"></div>
<script async src="${appUrl}/embed.js"></script>`;
  const iframeSnippet = `<iframe src="${appUrl}/embed/promoter/${slug}?limit=${limit}"
        style="width:100%;border:0;min-height:400px"
        loading="lazy" title="Tixly — akce"></iframe>`;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Embed — všechny tvé akce"
        description={'Vlož na svůj web mřížku všech svých nadcházejících akcí. Po kliknutí se kupec přesměruje na Tixly checkout. (Pro jednu konkrétní akci použij tlačítko „Embed" v detailu akce.)'}
      />

      <Card>
        <CardHeader><CardTitle>Kolik akcí zobrazit</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {[6, 12, 24].map((n) => (
              <button key={n} type="button" onClick={() => setLimit(n)}
                className={`rounded-md border px-4 py-2 text-sm ${limit === n ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {n}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>1. Náhled</CardTitle></CardHeader>
        <CardContent>
          <iframe
            src={`/embed/promoter/${slug}?limit=${limit}`}
            className="w-full rounded-md border bg-slate-50"
            style={{ minHeight: 420, border: 0 }}
            loading="lazy"
            title="Náhled embed"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Doporučený kód (auto-resize)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Vlož na svůj web. Widget se sám natáhne podle obsahu. Funguje na WordPress, Webflow,
            Squarespace, Shopify (přes „custom HTML" sekci) i plain HTML.
          </p>
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{htmlSnippet}</pre>
          <Button onClick={() => copy(htmlSnippet, 'html')}>{copied === 'html' ? '✓ Zkopírováno' : 'Zkopírovat kód'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Alternativa — plain iframe (bez JS)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Pro CSP omezení nebo systémy bez JS. Pevná výška, bez auto-resize.</p>
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{iframeSnippet}</pre>
          <Button variant="outline" onClick={() => copy(iframeSnippet, 'iframe')}>{copied === 'iframe' ? '✓ Zkopírováno' : 'Zkopírovat'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Tipy:</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Zobrazují se jen <strong>publikované, nadcházející</strong> akce — seznam se aktualizuje sám.</li>
            <li>Klik na akci otevře Tixly checkout v hlavním okně (ne v iframu).</li>
            <li>Na <strong>Shopify</strong>: přidej sekci „Custom Liquid" / „Custom HTML" a vlož doporučený kód.</li>
            <li>Pro embed jedné akce použij tlačítko „Embed" v detailu konkrétní akce.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
