'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Alert {
  id: string;
  event_id: string | null;
  event_title: string | null;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metadata: Record<string, unknown>;
  acknowledged_at: string | null;
  created_at: string;
}

const ALERT_ICONS: Record<string, string> = {
  traffic_spike: '🚀',
  refund_spike: '⚠️',
  fraud_cluster: '🚨',
  sellout_imminent: '🔥',
  queue_overflow: '📊',
  low_velocity: '🐌',
};

const SEVERITY_COLORS = {
  info: 'border-blue-300 bg-blue-50/50',
  warning: 'border-amber-300 bg-amber-50/50',
  critical: 'border-rose-300 bg-rose-50/50',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await authFetch(`/api/admin/alerts${showAll ? '?all=true' : ''}`);
    if (!res.ok) {
      setError(`HTTP ${res.status}`);
      return;
    }
    setAlerts((((await res.json()) as { alerts: Alert[] }).alerts) ?? []);
  }, [showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  async function ack(id: string) {
    await authFetch(`/api/admin/alerts/${id}/ack`, { method: 'POST' });
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="🔔 Anomaly alerts"
        description="Auto-detected issues: traffic spikes, refund spikes, fraud clusters, sellouts."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Jen aktivní' : 'Zobrazit všechny'}
          </Button>
        }
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {alerts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="text-4xl">✓</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {showAll ? 'Žádné alerts.' : 'Žádné aktivní alerts. Vše vypadá v pořádku.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <Card key={a.id} className={SEVERITY_COLORS[a.severity]}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{ALERT_ICONS[a.alert_type] ?? '⚠'}</span>
                      <div>
                        <div className="font-medium">{a.message}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          <span className="font-mono">{a.alert_type}</span>
                          {' · '}
                          {new Date(a.created_at).toLocaleString('cs-CZ')}
                          {a.acknowledged_at ? ` · ✓ ack ${new Date(a.acknowledged_at).toLocaleTimeString('cs-CZ')}` : ''}
                        </div>
                        {Object.keys(a.metadata ?? {}).length > 0 ? (
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-muted-foreground">
                              metadata
                            </summary>
                            <pre className="mt-1 rounded bg-muted/40 p-2 text-[10px]">
                              {JSON.stringify(a.metadata, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    {a.event_id ? (
                      <Link
                        href={`/admin/events/${a.event_id}/live-ops`}
                        className="text-xs text-primary hover:underline"
                      >
                        Live ops →
                      </Link>
                    ) : null}
                    {!a.acknowledged_at ? (
                      <Button size="sm" variant="outline" onClick={() => ack(a.id)}>
                        ✓ Ack
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
