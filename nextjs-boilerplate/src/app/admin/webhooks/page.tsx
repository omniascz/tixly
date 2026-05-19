'use client';

import { useEffect, useState } from 'react';
import { Webhook, Plus, Trash2, Activity, AlertCircle, Send } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  WEBHOOK_EVENT_TYPES,
  EVENT_TYPE_DESCRIPTION,
  type WebhookEventType,
} from '@/lib/webhooks/event-types';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  is_active: boolean;
  timeout_ms: number;
  max_retries: number;
  created_at: string;
  last_triggered_at: string | null;
  failed_count: number;
  success_count: number;
}

interface Delivery {
  id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  last_response_status: number | null;
  last_response_body: string | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export default function WebhooksPage(): JSX.Element {
  const [items, setItems] = useState<Endpoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    url: '',
    description: '',
    events: ['order.paid'] as string[],
  });
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; status: number | null; durationMs: number; body: string | null; error: string | null }>>({});

  async function load(): Promise<void> {
    setBusy(true);
    try {
      const r = await authFetch('/api/admin/webhooks');
      if (r.ok) {
        const data = (await r.json()) as { items: Endpoint[] };
        setItems(data.items);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadDeliveries(id: string): Promise<void> {
    const r = await authFetch(`/api/admin/webhooks/${id}/deliveries?limit=20`);
    if (r.ok) {
      const data = (await r.json()) as { items: Delivery[] };
      setDeliveries((cur) => ({ ...cur, [id]: data.items }));
    }
  }

  async function create(): Promise<void> {
    setNewSecret(null);
    const r = await authFetch('/api/admin/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: draft.url.trim(),
        description: draft.description.trim() || undefined,
        events: draft.events,
      }),
    });
    if (r.ok) {
      const data = (await r.json()) as { secret: string };
      setNewSecret(data.secret);
      setDraft({ url: '', description: '', events: ['order.paid'] });
      setShowNew(false);
      void load();
    } else {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      alert(`Chyba: ${data.error ?? r.status}`);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm('Smazat endpoint? Tato akce je nevratná.')) return;
    await authFetch(`/api/admin/webhooks/${id}`, { method: 'DELETE' });
    void load();
  }

  async function toggle(id: string, active: boolean): Promise<void> {
    await authFetch(`/api/admin/webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: active }),
    });
    void load();
  }

  async function sendTest(id: string): Promise<void> {
    setTestResult((cur) => ({ ...cur, [id]: { ok: false, status: null, durationMs: 0, body: null, error: 'Posílám…' } }));
    const r = await authFetch(`/api/admin/webhooks/${id}/test`, { method: 'POST' });
    const data = (await r.json()) as { ok: boolean; status: number | null; durationMs: number; responseBody: string | null; errorMsg: string | null };
    setTestResult((cur) => ({
      ...cur,
      [id]: {
        ok: data.ok,
        status: data.status,
        durationMs: data.durationMs,
        body: data.responseBody,
        error: data.errorMsg,
      },
    }));
  }

  function toggleEventInDraft(ev: WebhookEventType): void {
    setDraft((d) => ({
      ...d,
      events: d.events.includes(ev) ? d.events.filter((x) => x !== ev) : [...d.events, ev],
    }));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Outbound webhooks pro 3rd party integrace. HMAC SHA-256 signed přes X-Tixly-Signature header."
      />

      <div className="flex justify-end">
        <Button onClick={() => setShowNew((v) => !v)} size="sm">
          <Plus className="mr-1 h-4 w-4" /> {showNew ? 'Zrušit' : 'Nový endpoint'}
        </Button>
      </div>

      {newSecret ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <h3 className="font-semibold text-emerald-700">Endpoint vytvořen</h3>
            <p className="text-sm text-muted-foreground">
              Tohle je signing secret. <strong>Ulož si ho teď</strong> — už ho neuvidíš.
              Použij ho k ověření X-Tixly-Signature hlavičky:
            </p>
            <code className="block break-all rounded bg-muted p-3 font-mono text-sm">
              {newSecret}
            </code>
            <p className="text-xs text-muted-foreground">
              Ověření: <code>HMAC_SHA256(secret, request.body) === X-Tixly-Signature</code>
            </p>
            <Button size="sm" variant="outline" onClick={() => setNewSecret(null)}>
              Mám uloženo
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showNew ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <label className="mb-1 block text-xs font-medium">URL</label>
              <Input
                type="url"
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://example.com/tixly-webhook"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis (volit.)</label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Zapier integration, Slack alert..."
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-medium">Event typy</label>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {WEBHOOK_EVENT_TYPES.map((ev) => (
                  <label key={ev} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.events.includes(ev)}
                      onChange={() => toggleEventInDraft(ev)}
                      className="mt-0.5"
                    />
                    <div>
                      <code className="text-xs font-medium">{ev}</code>
                      <p className="text-xs text-muted-foreground">
                        {EVENT_TYPE_DESCRIPTION[ev]}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={create} disabled={!draft.url || draft.events.length === 0}>
              Vytvořit endpoint
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {busy && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Webhook className="mx-auto mb-3 h-8 w-8 opacity-30" />
            <p>Žádné webhooks endpoints. Zaregistruj první.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((ep) => {
            const isExpanded = expanded === ep.id;
            const tr = testResult[ep.id];
            const delivList = deliveries[ep.id] ?? [];
            return (
              <Card key={ep.id}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="break-all font-mono text-sm">{ep.url}</code>
                        {ep.is_active ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                            aktivní
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                            pauzováno
                          </span>
                        )}
                      </div>
                      {ep.description ? (
                        <p className="text-sm text-muted-foreground">{ep.description}</p>
                      ) : null}
                      <p className="mt-1 flex flex-wrap gap-1 text-xs">
                        {ep.events.map((e) => (
                          <code
                            key={e}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                          >
                            {e}
                          </code>
                        ))}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <Activity className="mr-1 inline h-3 w-3" />
                        {ep.success_count} úspěšných · {ep.failed_count} chyb ·
                        {ep.last_triggered_at
                          ? ` poslední ${new Date(ep.last_triggered_at).toLocaleString('cs-CZ')}`
                          : ' nikdy nespouštěn'}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="sm" variant="outline" onClick={() => sendTest(ep.id)}>
                        <Send className="mr-1 h-3 w-3" />
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggle(ep.id, !ep.is_active)}
                      >
                        {ep.is_active ? 'Pauzovat' : 'Aktivovat'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(ep.id)}>
                        <Trash2 className="h-3 w-3 text-rose-600" />
                      </Button>
                    </div>
                  </div>
                  {tr ? (
                    <div
                      className={`rounded-md border p-2 text-xs ${tr.ok ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}
                    >
                      {tr.ok ? '✓' : '✗'} {tr.status ?? '—'} ({tr.durationMs} ms)
                      {tr.error ? ` — ${tr.error}` : ''}
                      {tr.body ? <pre className="mt-1 whitespace-pre-wrap font-mono">{tr.body}</pre> : null}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (isExpanded) {
                        setExpanded(null);
                      } else {
                        setExpanded(ep.id);
                        void loadDeliveries(ep.id);
                      }
                    }}
                    className="text-xs text-primary underline"
                  >
                    {isExpanded ? 'Skrýt' : 'Zobrazit'} delivery historii
                  </button>
                  {isExpanded ? (
                    delivList.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Žádné deliveries zatím.</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-1">Čas</th>
                            <th>Event</th>
                            <th>Status</th>
                            <th>HTTP</th>
                            <th>Pokusy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {delivList.map((d) => (
                            <tr key={d.id} className="border-b">
                              <td className="py-1 text-muted-foreground">
                                {new Date(d.created_at).toLocaleString('cs-CZ')}
                              </td>
                              <td>
                                <code>{d.event_type}</code>
                              </td>
                              <td>
                                {d.status === 'success' ? '✓' : d.status === 'failed' ? '✗' : '…'}{' '}
                                {d.status}
                              </td>
                              <td>{d.last_response_status ?? '—'}</td>
                              <td>{d.attempt_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardContent className="space-y-2 pt-6 text-sm">
          <h3 className="font-semibold">Jak ověřit webhook</h3>
          <p className="text-muted-foreground">
            Každý request má hlavičky <code>X-Tixly-Signature</code> (HMAC SHA-256 hex z body
            + secret) a <code>X-Tixly-Event</code> (event_type).
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
{`// Node.js verification
const crypto = require('crypto');
const computed = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(req.rawBody)
  .digest('hex');
if (computed !== req.headers['x-tixly-signature']) {
  return res.status(401).end();
}`}
          </pre>
          <p className="text-xs text-muted-foreground">
            <AlertCircle className="mr-1 inline h-3 w-3" />
            Po failed pokusu Tixly retryuje 3× (5s, 30s, 5 min backoff). Po 3 chybách marked
            as failed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
