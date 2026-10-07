'use client';

/**
 * /admin/events/[id]/distribution
 *
 * Distribuční síť — TM Publish API ekvivalent.
 * Promotér zapne distribution_enabled a vybere, kteří registrovaní reselleri
 * mohou akci prodávat (volitelně s vlastní alokací a komisí).
 */

import { useEffect, useState, use } from 'react';
import { Globe, Store, CheckCircle, Info } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useRouteParams } from '@/lib/next/route-params';

interface Partner {
  id: string;
  name: string;
  contactEmail: string;
  defaultCommissionPct: number;
  assigned: boolean;
  active: boolean;
  allocationQty: number | null;
  commissionOverridePct: number | null;
}

interface Data {
  distributionEnabled: boolean;
  partners: Partner[];
}

function authFetch(url: string, opts?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

export default function DistributionPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = use(props.params);
  const { id: eventId } = useRouteParams(params);
  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // Local overrides before save
  const [overrides, setOverrides] = useState<
    Map<string, { active: boolean; allocationQty: string; commissionOverridePct: string }>
  >(new Map());

  const load = () => {
    void authFetch(`/api/admin/events/${eventId}/distribution`)
      .then(async (r) => {
        const d = (await r.json()) as Data;
        setData(d);
        const m = new Map<string, { active: boolean; allocationQty: string; commissionOverridePct: string }>();
        for (const p of d.partners) {
          m.set(p.id, {
            active: p.active,
            allocationQty: p.allocationQty ? String(p.allocationQty) : '',
            commissionOverridePct: p.commissionOverridePct != null ? String(p.commissionOverridePct) : '',
          });
        }
        setOverrides(m);
      });
  };

  useEffect(load, [eventId]);

  async function toggleDistribution() {
    if (!data) return;
    setSaving(true);
    setStatus(null);
    const r = await authFetch(`/api/admin/events/${eventId}/distribution`, {
      method: 'PATCH',
      body: JSON.stringify({ distributionEnabled: !data.distributionEnabled }),
    });
    setSaving(false);
    if (r.ok) {
      setStatus(!data.distributionEnabled ? 'Distribuce zapnuta.' : 'Distribuce vypnuta.');
      load();
    } else {
      setStatus('Chyba při změně.');
    }
  }

  async function savePartners() {
    if (!data) return;
    setSaving(true);
    setStatus(null);
    const partners = data.partners
      .filter((p) => overrides.get(p.id)?.active || p.assigned)
      .map((p) => {
        const ov = overrides.get(p.id);
        return {
          partnerId: p.id,
          active: ov?.active ?? false,
          allocationQty: ov?.allocationQty ? parseInt(ov.allocationQty, 10) : null,
          commissionOverridePct:
            ov?.commissionOverridePct !== '' && ov?.commissionOverridePct != null
              ? parseFloat(ov.commissionOverridePct)
              : null,
        };
      });
    const r = await authFetch(`/api/admin/events/${eventId}/distribution`, {
      method: 'PATCH',
      body: JSON.stringify({ partners }),
    });
    setSaving(false);
    if (r.ok) {
      setStatus('Nastavení uloženo.');
      load();
    } else {
      setStatus('Chyba při ukládání.');
    }
  }

  if (!data) return <p className="text-sm text-muted-foreground p-6">Načítám…</p>;

  const apiUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/distribution/catalog`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Distribuční síť"
        description="Zapněte distribuci a vyberte, kteří partneři mohou vaši akci prodávat na svých platformách."
      />

      {status && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          <CheckCircle className="h-4 w-4 flex-shrink-0" />
          {status}
        </div>
      )}

      {/* Master toggle */}
      <Card className={data.distributionEnabled ? 'border-emerald-300' : undefined}>
        <CardContent className="flex items-center gap-4 py-5">
          <div
            className={`rounded-full p-3 ${data.distributionEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}
          >
            <Globe className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="font-semibold">
              Distribuce {data.distributionEnabled ? 'zapnuta' : 'vypnuta'}
            </div>
            <div className="text-sm text-muted-foreground">
              {data.distributionEnabled
                ? 'Akce je viditelná a prodejná přes distribuční partnery.'
                : 'Akce se prodává jen přes Tixly. Zapněte pro prodej přes partnery.'}
            </div>
          </div>
          <Button
            variant={data.distributionEnabled ? 'outline' : 'default'}
            onClick={toggleDistribution}
            disabled={saving}
          >
            {data.distributionEnabled ? 'Vypnout' : 'Zapnout distribuci'}
          </Button>
        </CardContent>
      </Card>

      {/* API info */}
      {data.distributionEnabled && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <Info className="h-4 w-4 mt-0.5 text-blue-600 flex-shrink-0" />
            <div>
              <span className="font-medium text-blue-900">Partner Discovery API:</span>{' '}
              <code className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-mono">
                GET {apiUrl}
              </code>
              <span className="ml-1 text-blue-800">
                (auth: <code className="text-xs">X-Partner-Key: &lt;api_key&gt;</code>)
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Partners */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <Store className="h-4 w-4 text-primary" />
            Distribuční partneři ({data.partners.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Zaškrtněte partnery, přes které chcete akci prodávat. Volitelně nastavte alokaci lístků a vlastní provizi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.partners.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Zatím žádní aktivní distribuční partneři. Správce Tixly je musí nejprve schválit.
            </p>
          ) : (
            <div className="space-y-3">
              {data.partners.map((p) => {
                const ov = overrides.get(p.id) ?? {
                  active: false,
                  allocationQty: '',
                  commissionOverridePct: '',
                };
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border p-3 ${ov.active ? 'border-primary/40 bg-primary/5' : 'border-muted'}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={ov.active}
                        onChange={(e) => {
                          const m = new Map(overrides);
                          m.set(p.id, { ...ov, active: e.target.checked });
                          setOverrides(m);
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{p.name}</span>
                          <Badge variant="outline" className="text-xs">
                            Provize {p.defaultCommissionPct} %
                          </Badge>
                          <span className="text-xs text-muted-foreground">{p.contactEmail}</span>
                        </div>
                        {ov.active && (
                          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div>
                              <label className="text-xs text-muted-foreground">Alokace (volitelná)</label>
                              <Input
                                type="number"
                                min={1}
                                placeholder="∞"
                                className="h-7 text-xs mt-0.5"
                                value={ov.allocationQty}
                                onChange={(e) => {
                                  const m = new Map(overrides);
                                  m.set(p.id, { ...ov, allocationQty: e.target.value });
                                  setOverrides(m);
                                }}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground">
                                Provize override (%)
                              </label>
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                placeholder={String(p.defaultCommissionPct)}
                                className="h-7 text-xs mt-0.5"
                                value={ov.commissionOverridePct}
                                onChange={(e) => {
                                  const m = new Map(overrides);
                                  m.set(p.id, { ...ov, commissionOverridePct: e.target.value });
                                  setOverrides(m);
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button onClick={savePartners} disabled={saving} size="sm" className="mt-2">
                {saving ? 'Ukládám…' : 'Uložit nastavení partnerů'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
