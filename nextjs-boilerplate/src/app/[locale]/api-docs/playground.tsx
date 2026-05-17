'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  endpoint: string;
  initialQuery: string;
}

export function ApiDocsPlayground({ endpoint, initialQuery }: Props): JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const [response, setResponse] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (): void => {
    setError(null);
    setResponse('');
    startTransition(async () => {
      try {
        const r = await fetch(endpoint || '/api/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        });
        const json: unknown = await r.json();
        setResponse(JSON.stringify(json, null, 2));
        if (!r.ok) setError(`HTTP ${r.status}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error');
      }
    });
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Query
        </label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          className="h-72 w-full rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button onClick={run} disabled={pending} className="mt-2">
          {pending ? 'Running…' : 'Run query'}
        </Button>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Response
        </label>
        <pre className="h-72 w-full overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
          {error ? <span className="text-destructive">{error}</span> : null}
          {error ? '\n\n' : ''}
          {response || '—'}
        </pre>
      </div>
    </div>
  );
}
