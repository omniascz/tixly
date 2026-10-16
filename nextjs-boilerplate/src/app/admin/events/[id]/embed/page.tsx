'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouteParams } from '@/lib/next/route-params';

export default function EmbedAdminPage(_props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = useParams<{ id: string }>();
  const { id: eventId } = useRouteParams(params);
  const [variant, setVariant] = useState<'card' | 'button'>('card');
  const [copied, setCopied] = useState<string | null>(null);
  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';

  const htmlSnippet = `<div data-tixly-event="${eventId}" data-variant="${variant}"></div>
<script async src="${appUrl}/embed.js"></script>`;

  const iframeSnippet = `<iframe src="${appUrl}/embed/event/${eventId}?variant=${variant}"
        style="width:100%;border:0;min-height:${variant === 'button' ? '60px' : '500px'}"
        loading="lazy" title="Tixly vstupenky"></iframe>`;

  function copy(text: string, key: string): void {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Embed widget"
        description={'Vlož prodejní widget na svůj web. Po kliknutí na „Koupit" se kupec přesměruje na Tixly checkout.'}
      />

      <Card>
        <CardHeader>
          <CardTitle>Varianta</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setVariant('card')}
              className={`rounded-md border px-4 py-2 text-sm ${
                variant === 'card' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              📇 Karta s detailem
            </button>
            <button
              type="button"
              onClick={() => setVariant('button')}
              className={`rounded-md border px-4 py-2 text-sm ${
                variant === 'button' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              🔘 Jen tlačítko „Koupit"
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>1. Náhled</CardTitle>
        </CardHeader>
        <CardContent>
          <iframe
            src={`/embed/event/${eventId}?variant=${variant}`}
            className="w-full rounded-md border bg-slate-50"
            style={{
              minHeight: variant === 'button' ? 60 : 500,
              border: 0,
            }}
            loading="lazy"
            title="Náhled embed"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Doporučený kód (auto-resize)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Vlož na svůj web. Widget se sám natáhne podle obsahu. Funguje na WordPress,
            Webflow, plain HTML, Squarespace atd.
          </p>
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {htmlSnippet}
          </pre>
          <Button onClick={() => copy(htmlSnippet, 'html')}>
            {copied === 'html' ? '✓ Zkopírováno' : 'Zkopírovat kód'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Alternativa — plain iframe (bez JS)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pokud nechceš JS (CSP omezení), použij plain iframe. Bez auto-resize — vyžaduje
            pevnou výšku.
          </p>
          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {iframeSnippet}
          </pre>
          <Button variant="outline" onClick={() => copy(iframeSnippet, 'iframe')}>
            {copied === 'iframe' ? '✓ Zkopírováno' : 'Zkopírovat'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          <strong>Tipy:</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Widget je responzivní — funguje na mobilu i desktopu.</li>
            <li>Klik na „Koupit" otevře Tixly checkout v top window (ne v iframu).</li>
            <li>Cena se vždy reflektuje aktuální v DB — žádný cache na embed straně.</li>
            <li>Pokud měníš brand color v Tixly admin, widget se automaticky aktualizuje.</li>
            <li>
              Více widgetů na jedné stránce funguje — každý <code>&lt;div data-tixly-event=...&gt;</code>{' '}
              vytvoří vlastní iframe.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
