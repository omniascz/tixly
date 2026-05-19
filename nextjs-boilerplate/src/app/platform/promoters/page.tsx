'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Promoter {
  id: string;
  name: string;
  slug: string;
  contact_email: string;
  status: 'pending' | 'active' | 'suspended';
  member_count: string;
  event_count: string;
}

export default function PlatformPromotersPage() {
  const [items, setItems] = useState<Promoter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/platform/promoters');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.promoters ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function action(id: string, kind: 'approve' | 'suspend') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/promoters/${id}/${kind}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function statusBadge(s: Promoter['status']) {
    const colors = {
      pending: 'bg-amber-100 text-amber-800',
      active: 'bg-emerald-100 text-emerald-800',
      suspended: 'bg-rose-100 text-rose-800',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${colors[s]}`}>
        {s}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Promotéři</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Všichni promotéři ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Název</th>
                <th>E-mail</th>
                <th>Status</th>
                <th>Členů</th>
                <th>Akcí</th>
                <th className="text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b hover:bg-muted/30">
                  <td className="py-2 font-medium">
                    <a href={`/platform/promoters/${p.id}`} className="text-primary hover:underline">
                      {p.name}
                    </a>
                    <div className="text-xs text-muted-foreground">{p.slug}</div>
                  </td>
                  <td>{p.contact_email}</td>
                  <td>{statusBadge(p.status)}</td>
                  <td>{p.member_count}</td>
                  <td>{p.event_count}</td>
                  <td className="text-right">
                    <a
                      href={`/platform/promoters/${p.id}`}
                      className="mr-2 text-xs text-primary hover:underline"
                    >
                      Detail →
                    </a>
                    {p.status !== 'active' && (
                      <Button
                        size="sm"
                        onClick={() => action(p.id, 'approve')}
                        disabled={busyId === p.id}
                        className="mr-2"
                      >
                        Schválit
                      </Button>
                    )}
                    {p.status !== 'suspended' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => action(p.id, 'suspend')}
                        disabled={busyId === p.id}
                      >
                        Pozastavit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
