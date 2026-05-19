'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  href: string;
  required: boolean;
}

interface OnboardingData {
  items: ChecklistItem[];
  progress: { completed: number; total: number; pct: number };
  required: { completed: number; total: number; ready: boolean };
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export default function OnboardingPage() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      const res = await authFetch('/api/admin/onboarding');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData(await res.json());
    }
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Načítání…</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        description="Splň kroky pro spuštění tvého promotér účtu."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Pokrok</span>
            <span className="text-2xl font-bold tabular-nums">{data.progress.pct}%</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full transition-all ${
                data.required.ready ? 'bg-emerald-500' : 'bg-primary'
              }`}
              style={{ width: `${data.progress.pct}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {data.progress.completed} z {data.progress.total} kroků hotovo (
            {data.required.completed} z {data.required.total} povinných)
          </p>
          {data.required.ready ? (
            <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">
              ✓ Účet je plně nastavený a připravený na prodej.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {data.items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`block rounded-lg border p-4 transition hover:bg-muted/30 ${
              item.completed ? 'border-emerald-300 bg-emerald-50/30' : 'border-border bg-card'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${
                  item.completed
                    ? 'bg-emerald-500 text-white'
                    : 'border-2 border-muted-foreground/40'
                }`}
                aria-hidden
              >
                {item.completed ? '✓' : ''}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className={`font-medium ${item.completed ? 'line-through opacity-60' : ''}`}>
                    {item.label}
                  </h3>
                  {item.required ? (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-rose-800">
                      povinné
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.description}</p>
              </div>
              <span className="text-xs text-primary">→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
