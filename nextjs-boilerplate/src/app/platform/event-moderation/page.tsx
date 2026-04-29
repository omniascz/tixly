'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCzechDate } from '@/lib/format';

interface QueueItem {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  status: string;
  created_at: string;
  promoter_name: string;
  promoter_slug: string;
  matched_keywords: string[] | null;
  reason: string | null;
}

export default function EventModerationPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/platform/moderation/queue');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba načítání');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function approve(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/platform/moderation/${id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string): Promise<void> {
    const reason = window.prompt('Důvod zamítnutí (povinné, min 3 znaky):');
    if (!reason || reason.trim().length < 3) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/platform/moderation/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setBusyId(null);
    }
  }

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Moderace akcí</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Akce čekající na schválení. Po schválení jdou do prodeje na{' '}
          <code>/cs/events</code>.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Fronta je prázdná. Všechno schváleno.
          </CardContent>
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{item.title}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {item.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <strong>Promotér:</strong> {item.promoter_name} ({item.promoter_slug})
                </div>
                <div>
                  <strong>Datum akce:</strong> {formatCzechDate(item.date_start)}
                </div>
                <div>
                  <strong>Vytvořeno:</strong> {formatCzechDate(item.created_at)}
                </div>
                <div>
                  <strong>Důvod fronty:</strong> {item.reason ?? '—'}
                </div>
              </div>
              {item.matched_keywords && item.matched_keywords.length > 0 && (
                <div className="rounded bg-rose-50 p-2 text-xs">
                  <strong className="text-rose-800">Zachycené keywords:</strong>{' '}
                  {item.matched_keywords.join(', ')}
                </div>
              )}
              {item.description && (
                <div>
                  <button
                    type="button"
                    className="text-xs text-blue-600 underline"
                    onClick={() => toggle(item.id)}
                  >
                    {expanded.has(item.id) ? 'Skrýt' : 'Zobrazit'} popis
                  </button>
                  {expanded.has(item.id) && (
                    <p className="mt-2 whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                      {item.description}
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => approve(item.id)}
                  disabled={busyId === item.id}
                >
                  Schválit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => reject(item.id)}
                  disabled={busyId === item.id}
                >
                  Zamítnout
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
