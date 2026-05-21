'use client';

import { useEffect, useState } from 'react';
import { Tag, Plus, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Pixel {
  id: string; event_id: string | null;
  platform: string; pixel_id: string;
  events_tracked: string[]; is_active: boolean;
  created_at: string;
}

const PLATFORMS = [
  { value: 'meta', label: 'Meta Pixel (Facebook + Instagram)', placeholder: '123456789012345' },
  { value: 'google_ads', label: 'Google Ads', placeholder: 'AW-1234567890' },
  { value: 'google_analytics', label: 'Google Analytics 4', placeholder: 'G-XXXXXXXXXX' },
  { value: 'tiktok', label: 'TikTok Pixel', placeholder: 'C9XXXXXXXXXXX' },
  { value: 'linkedin', label: 'LinkedIn Insight Tag', placeholder: '1234567' },
  { value: 'twitter', label: 'Twitter / X Pixel', placeholder: 'o0xxx' },
] as const;

export default function TrackingPixelsPage(): JSX.Element {
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [platform, setPlatform] = useState('meta');
  const [pixelId, setPixelId] = useState('');
  const [scope, setScope] = useState<'all' | 'event'>('all');
  const [eventId, setEventId] = useState('');

  useEffect(() => { void load(); }, []);

  async function load(): Promise<void> {
    try {
      const r = await typedGet<{ pixels: Pixel[] }>('/api/admin/tracking-pixels');
      setPixels(r.pixels ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await typedPost('/api/admin/tracking-pixels', {
        platform, pixelId,
        eventId: scope === 'event' && eventId ? eventId : null,
      }, { throwOnError: true });
      setShowForm(false);
      setPixelId(''); setEventId('');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        setError((err.body as { error?: string })?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Tracking Pixels"
        description="Meta Pixel, Google Ads, GA4, TikTok, LinkedIn — vlož svůj tracking ID pro retargeting a conversion measurement."
      />

      {error ? <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}

      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">{pixels.length} aktivních pixelů</p>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Zavřít' : '+ Nový pixel'}</Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader><CardTitle>Nový pixel</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Platform</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Pixel ID *</label>
              <Input value={pixelId} onChange={(e) => setPixelId(e.target.value)}
                placeholder={PLATFORMS.find((p) => p.value === platform)?.placeholder} />
              <p className="mt-1 text-xs text-muted-foreground">
                Najdeš v admin svého ad účtu. Pro Meta: Events Manager → Pixel ID. Pro Google Ads: Conversions → Tag setup.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Rozsah</label>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
                  <span>Všechny akce (promoter-wide)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={scope === 'event'} onChange={() => setScope('event')} />
                  <span>Jen konkrétní akce</span>
                </label>
              </div>
            </div>
            {scope === 'event' ? (
              <div>
                <label className="mb-1 block text-xs font-medium">Event ID</label>
                <Input value={eventId} onChange={(e) => setEventId(e.target.value)}
                  placeholder="UUID akce" />
              </div>
            ) : null}
            <Button onClick={create} disabled={busy || !pixelId}>
              <Plus className="mr-1 h-4 w-4" /> {busy ? 'Ukládám…' : 'Aktivovat pixel'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {pixels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Tag className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Žádné pixely. Vlož Meta Pixel ID a zachytíš všechny ViewContent / AddToCart / Purchase events pro retargeting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {pixels.map((p) => {
            const platformInfo = PLATFORMS.find((x) => x.value === p.platform);
            return (
              <Card key={p.id}>
                <CardContent className="flex items-center justify-between pt-4">
                  <div>
                    <p className="font-semibold">{platformInfo?.label ?? p.platform}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.pixel_id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.event_id ? `Akce: ${p.event_id.slice(0, 8)}...` : '🌍 Všechny akce'}
                      {' · '}
                      Eventy: {p.events_tracked.join(', ')}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs ${
                    p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {p.is_active ? 'Aktivní' : 'Pozastaven'}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-blue-200 bg-blue-50/30">
        <CardContent className="flex gap-3 pt-6">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-blue-700" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold">GDPR & DSA compliance</p>
            <p className="mt-1 text-xs">
              Pixely se zobrazují jen návštěvníkům, kteří udělili souhlas s marketing cookies.
              Tixly automaticky integruje s consent banner. Pro Meta CAPI doporučujeme
              i server-side eventy přes <code>/api/internal/conversion-event</code>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
