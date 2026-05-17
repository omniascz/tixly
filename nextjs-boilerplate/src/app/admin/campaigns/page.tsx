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
  const [segmentLastOrderWithin, setSegmentLastOrderWithin] = useState('');
  const [segmentCity, setSegmentCity] = useState('');
  const [segmentMinOrders, setSegmentMinOrders] = useState('');
  const [segmentMinSpend, setSegmentMinSpend] = useState(''); // in Kč
  const [segmentEventTag, setSegmentEventTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'manual' | 'smart'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [smart, setSmart] = useState<null | {
    scheduledAtIso: string;
    bestHourLocal: number;
    bestDayOfWeek: number;
    basis: string;
    confidence: string;
    sampleSize: number;
  }>(null);
  const [smartBusy, setSmartBusy] = useState(false);

  async function fetchSmart(): Promise<void> {
    setSmartBusy(true);
    try {
      const r = await authFetch(`/api/admin/campaigns/smart-send-time?channel=${channel}`);
      if (r.ok) {
        const data = (await r.json()) as typeof smart;
        setSmart(data);
      }
    } finally {
      setSmartBusy(false);
    }
  }

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
      if (segmentLastOrderWithin.trim()) {
        segment.last_order_within_days = Number(segmentLastOrderWithin);
      }
      if (segmentCity.trim()) {
        segment.city = segmentCity.trim();
      }
      if (segmentMinOrders.trim()) {
        segment.min_orders = Number(segmentMinOrders);
      }
      if (segmentMinSpend.trim()) {
        segment.min_total_spend_halire = Number(segmentMinSpend) * 100;
      }
      if (segmentEventTag.trim()) {
        segment.event_tag = segmentEventTag.trim();
      }

      let resolvedScheduledAt: string | undefined;
      if (scheduleMode === 'manual' && scheduledAt) {
        resolvedScheduledAt = new Date(scheduledAt).toISOString();
      } else if (scheduleMode === 'smart' && smart) {
        resolvedScheduledAt = smart.scheduledAtIso;
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
          scheduledAt: resolvedScheduledAt,
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
                Začni se všemi mými kupci a dále filtruj níže
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs">
                    Poslední nákup PŘED X dny (re-engagement spáčů)
                  </label>
                  <Input
                    type="number"
                    placeholder="např. 90"
                    value={segmentLastOrderDays}
                    onChange={(e) => setSegmentLastOrderDays(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    Poslední nákup DO X dnů (aktivní fanoušci)
                  </label>
                  <Input
                    type="number"
                    placeholder="např. 30"
                    value={segmentLastOrderWithin}
                    onChange={(e) => setSegmentLastOrderWithin(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    Město venue (kde byl kupec)
                  </label>
                  <Input
                    placeholder="např. Praha"
                    value={segmentCity}
                    onChange={(e) => setSegmentCity(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    Minimum objednávek od kupce
                  </label>
                  <Input
                    type="number"
                    placeholder="např. 3 (loyal customer)"
                    value={segmentMinOrders}
                    onChange={(e) => setSegmentMinOrders(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    Minimum celkové útraty (Kč)
                  </label>
                  <Input
                    type="number"
                    placeholder="např. 5000"
                    value={segmentMinSpend}
                    onChange={(e) => setSegmentMinSpend(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs">
                    AI tag akce (genre / audience / vibe)
                  </label>
                  <Input
                    placeholder="např. jazz, family, rock"
                    value={segmentEventTag}
                    onChange={(e) => setSegmentEventTag(e.target.value)}
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Kombinace dimenzí filtruje AND. Aktivní filtry se sečtou — kupec
                musí splňovat všechny.
              </p>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <h4 className="mb-2 text-xs font-medium uppercase">Naplánování</h4>
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="schedule"
                    checked={scheduleMode === 'now'}
                    onChange={() => setScheduleMode('now')}
                  />
                  Odeslat hned (draft, ručně spustit „Send")
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="schedule"
                    checked={scheduleMode === 'manual'}
                    onChange={() => setScheduleMode('manual')}
                  />
                  Naplánovat na konkrétní čas
                </label>
                {scheduleMode === 'manual' ? (
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="ml-6 max-w-xs"
                  />
                ) : null}
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="schedule"
                    checked={scheduleMode === 'smart'}
                    onChange={() => {
                      setScheduleMode('smart');
                      if (!smart) void fetchSmart();
                    }}
                  />
                  ⚡ Smart send-time (AI doporučí nejlepší moment)
                </label>
                {scheduleMode === 'smart' ? (
                  <div className="ml-6 space-y-1 rounded-md border bg-background p-2 text-xs">
                    {smartBusy ? (
                      <span className="text-muted-foreground">Analyzuji historical opens…</span>
                    ) : smart ? (
                      <>
                        <p>
                          <strong>
                            {new Date(smart.scheduledAtIso).toLocaleString('cs-CZ')}
                          </strong>{' '}
                          (
                          {
                            ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'][
                              smart.bestDayOfWeek
                            ]
                          }{' '}
                          {smart.bestHourLocal}:00)
                        </p>
                        <p className="text-muted-foreground">
                          Základ:{' '}
                          {smart.basis === 'historical'
                            ? `historical opens (${smart.sampleSize} samples, ${smart.confidence} confidence)`
                            : 'industry best practice (žádná historie)'}
                        </p>
                        <button
                          type="button"
                          onClick={fetchSmart}
                          className="text-primary underline"
                        >
                          Přepočítat
                        </button>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Načtu doporučení…</span>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={create} disabled={busy || !name.trim()}>
                {busy
                  ? 'Vytvářím…'
                  : scheduleMode === 'now'
                    ? 'Vytvořit jako draft'
                    : 'Vytvořit a naplánovat'}
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
