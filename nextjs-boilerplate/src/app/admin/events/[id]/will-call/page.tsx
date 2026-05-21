'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Ticket, MapPin, Clock, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedFetch, TypedFetchError } from '@/lib/typed-fetch';

interface Config {
  delivery_methods: string[];
  will_call_pickup_location: string | null;
  will_call_pickup_hours: string | null;
  will_call_id_required: boolean;
}

interface Stats {
  pickedUp: number;
  pending: number;
}

export default function WillCallPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [eventId]);

  async function load(): Promise<void> {
    try {
      const data = await typedGet<{ config: Config; stats: Stats }>(
        `/api/admin/events/${eventId}/will-call`,
      );
      setConfig(data.config);
      setStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chyba');
    }
  }

  async function patch(updates: Partial<{
    deliveryMethods: string[];
    willCallPickupLocation: string;
    willCallPickupHours: string;
    willCallIdRequired: boolean;
  }>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await typedFetch(`/api/admin/events/${eventId}/will-call`, {
        method: 'PATCH', body: updates, throwOnError: true,
      });
      setSaved(true);
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

  function toggleDelivery(method: string): void {
    if (!config) return;
    const newMethods = config.delivery_methods.includes(method)
      ? config.delivery_methods.filter((m) => m !== method)
      : [...config.delivery_methods, method];
    if (newMethods.length === 0) {
      setError('Musíš povolit alespoň jeden způsob doručení.');
      return;
    }
    void patch({ deliveryMethods: newMethods });
  }

  if (!config) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title="Will Call (vyzvednutí na pokladně)" description="Doplňková možnost vedle digital lístků. Buyer si v checkoutu zvolí Will Call, na akci přijde s dokladem na pokladnu." />
        <div className="text-sm text-muted-foreground">{error ?? 'Načítám…'}</div>
      </div>
    );
  }

  const willCallEnabled = config.delivery_methods.includes('will_call');

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Will Call (vyzvednutí na pokladně)"
        description="Doplňková možnost vedle digital lístků. Buyer si v checkoutu zvolí Will Call, na akci přijde s dokladem na pokladnu."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}
      {saved ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Uloženo.</div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5" />
            Povolené způsoby doručení
          </CardTitle>
          <CardDescription>
            Buyer si v checkoutu zvolí jeden z povolených.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: 'mobile', label: '📱 Mobile', desc: 'PWA / app' },
              { key: 'pdf', label: '📄 PDF', desc: 'Tisk doma' },
              { key: 'wallet', label: '💳 Wallet', desc: 'Apple/Google' },
              { key: 'will_call', label: '🎫 Will Call', desc: 'Na pokladně' },
            ].map((m) => (
              <button
                type="button"
                key={m.key}
                onClick={() => toggleDelivery(m.key)}
                disabled={busy}
                className={`rounded-md border p-3 text-left transition ${
                  config.delivery_methods.includes(m.key)
                    ? 'border-primary bg-primary/10'
                    : 'border-border'
                }`}
              >
                <p className="font-medium">{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {willCallEnabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Will Call konfigurace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium">
                  <MapPin className="h-3 w-3" /> Lokalita pokladny
                </label>
                <Input
                  defaultValue={config.will_call_pickup_location ?? ''}
                  onBlur={(e) => patch({ willCallPickupLocation: e.target.value })}
                  placeholder="např. Hlavní vchod, vlevo od šatny"
                  maxLength={500}
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-1 text-xs font-medium">
                  <Clock className="h-3 w-3" /> Otevírací doba
                </label>
                <Input
                  defaultValue={config.will_call_pickup_hours ?? ''}
                  onBlur={(e) => patch({ willCallPickupHours: e.target.value })}
                  placeholder="např. 60 min před začátkem až do startu"
                  maxLength={200}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={config.will_call_id_required}
                  onChange={(e) => patch({ willCallIdRequired: e.target.checked })}
                  className="h-4 w-4"
                />
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <span>Vyžadovat kontrolu dokladu při vyzvednutí</span>
              </label>
            </CardContent>
          </Card>

          {stats ? (
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs uppercase text-muted-foreground">Vyzvednuto</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">{stats.pickedUp}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs uppercase text-muted-foreground">Čeká na vyzvednutí</p>
                  <p className="mt-1 text-2xl font-bold text-amber-700">{stats.pending}</p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Box office app</CardTitle>
              <CardDescription>
                Pokladní personál používá scanner app — vyhledá objednávku přes email/QR/jméno
                a stiskne tlačítko „Vyzvednuto". POS scanner aktivně synchronizuje s touto akcí.
              </CardDescription>
            </CardHeader>
          </Card>
        </>
      ) : null}
    </div>
  );
}
