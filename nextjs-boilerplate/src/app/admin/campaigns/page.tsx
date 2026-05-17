'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface Campaign {
  id: string;
  name: string;
  channel: 'email' | 'sms' | 'push' | 'inapp';
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'failed';
  subject: string | null;
  recipientCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  conversionCount: number;
  revenueHalire: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<Campaign['status'], string> = {
  draft: 'bg-slate-100 text-slate-700',
  scheduled: 'bg-blue-100 text-blue-800',
  sending: 'bg-amber-100 text-amber-800',
  sent: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-100 text-slate-700',
  failed: 'bg-rose-100 text-rose-800',
};

const CHANNEL_ICONS = { email: '📧', sms: '📱', push: '🔔', inapp: '💬' };

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

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

export default function CampaignsPage() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Campaign['channel']>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [utmCampaign, setUtmCampaign] = useState('');
  const [segmentAllBuyers, setSegmentAllBuyers] = useState(true);
  const [segmentLastOrderDays, setSegmentLastOrderDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const res = await authFetch('/api/admin/campaigns');
    if (res.ok) {
      const d = (await res.json()) as { items: Campaign[] };
      setItems(d.items);
    }
  }

  async function create() {
    setBusy(true);
    setFeedback(null);
    try {
      const segment: Record<string, unknown> = {};
      if (segmentAllBuyers) segment.all_buyers = true;
      if (segmentLastOrderDays.trim()) {
        segment.last_order_older_than_days = Number(segmentLastOrderDays);
      }

      const res = await authFetch('/api/admin/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name,
          channel,
          subject: subject || undefined,
          bodyHtml: body || undefined,
          utmSource: 'tixly',
          utmMedium: channel,
          utmCampaign: utmCampaign || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          segment,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setFeedback(`Chyba: ${d.error ?? res.status}`);
        return;
      }
      setFeedback(`Kampaň vytvořena. Odhadovaní příjemci: ${d.estimatedRecipients}.`);
      setName('');
      setSubject('');
      setBody('');
      setUtmCampaign('');
      setShowNew(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing kampaně"
        description="Vytvořit email / SMS / push kampaň pro segment kupců. Sledování click + konverze."
        actions={
          <Button onClick={() => setShowNew(!showNew)}>
            {showNew ? 'Zavřít' : '+ Nová kampaň'}
          </Button>
        }
      />

      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      {showNew ? (
        <Card>
          <CardHeader>
            <CardTitle>Nová kampaň</CardTitle>
            <CardDescription>
              Draft. Po vytvoření můžeš editovat content a teprve potom spustit „Send".
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Název</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="např. R&J jaro 2026"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kanál</label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as Campaign['channel'])}
                >
                  <option value="email">📧 Email</option>
                  <option value="sms">📱 SMS</option>
                  <option value="push">🔔 Push notifikace</option>
                  <option value="inapp">💬 In-app</option>
                </select>
              </div>
            </div>

            {channel === 'email' ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Subject (předmět)</label>
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-medium">
                Obsah {channel === 'email' ? '(HTML)' : '(text)'}
              </label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium">
                UTM Campaign (pro attribution)
              </label>
              <Input
                value={utmCampaign}
                onChange={(e) => setUtmCampaign(e.target.value)}
                placeholder="auto: odvozeno z názvu"
              />
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-medium uppercase">Segment příjemců</h4>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={segmentAllBuyers}
                  onChange={(e) => setSegmentAllBuyers(e.target.checked)}
                />
                Všichni moji kupci
              </label>
              <div className="mt-2">
                <label className="mb-1 block text-xs">
                  Poslední nákup před X dny (re-engagement)
                </label>
                <Input
                  type="number"
                  placeholder="např. 90 (kdo nekoupil 90+ dní)"
                  value={segmentLastOrderDays}
                  onChange={(e) => setSegmentLastOrderDays(e.target.value)}
                  className="max-w-48"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy ? 'Vytvářím…' : 'Vytvořit jako draft'}
              </Button>
              <Button variant="outline" onClick={() => setShowNew(false)}>
                Zrušit
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Žádné kampaně. Klikni „Nová kampaň" výše.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <Card key={c.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>{CHANNEL_ICONS[c.channel]}</span>
                      <h3 className="truncate font-semibold">{c.name}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLORS[c.status]}`}
                      >
                        {c.status}
                      </span>
                    </div>
                    {c.subject ? (
                      <p className="mt-1 text-xs text-muted-foreground">{c.subject}</p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString('cs-CZ')}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-6">
                  <Metric label="Příjemci" value={c.recipientCount} />
                  <Metric label="Odesláno" value={c.sentCount} />
                  <Metric label="Otevřeno" value={c.openCount} />
                  <Metric label="Klik" value={c.clickCount} />
                  <Metric label="Konverze" value={c.conversionCount} />
                  <Metric label="Tržby" value={fmt(c.revenueHalire)} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
