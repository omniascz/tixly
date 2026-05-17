'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface ChannelRow {
  channel: string;
  touchpoints: number;
  conversions: number;
  revenueHalire: number;
  conversionRate: number;
}

interface CampaignRow {
  name: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  sentCount: number;
  clickCount: number;
  conversionCount: number;
  revenueHalire: number;
}

interface OverviewData {
  period: { days: number };
  summary: { total_touchpoints: string; total_conversions: string; total_revenue: string };
  channels: ChannelRow[];
  campaigns: CampaignRow[];
}

function fmt(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

const CHANNEL_LABELS: Record<string, { icon: string; label: string }> = {
  direct: { icon: '🌐', label: 'Direct / přímé' },
  google: { icon: '🔍', label: 'Google' },
  google_ads: { icon: '💰', label: 'Google Ads' },
  facebook: { icon: '👍', label: 'Facebook' },
  instagram: { icon: '📷', label: 'Instagram' },
  email: { icon: '📧', label: 'Email kampaň' },
  newsletter: { icon: '📰', label: 'Newsletter' },
  tixly_marketplace: { icon: '🎫', label: 'Tixly Marketplace' },
  partner: { icon: '🤝', label: 'Partner' },
  affiliate: { icon: '🔗', label: 'Affiliate' },
  tiktok: { icon: '🎵', label: 'TikTok' },
  organic: { icon: '🌱', label: 'Organic search' },
};

export default function MarketingPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [days]);

  async function load() {
    setError(null);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/admin/marketing/overview?days=${days}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as OverviewData);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Marketing" />
        {error ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
            {error}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        )}
      </div>
    );
  }

  const totalRev = Number(data.summary.total_revenue);
  const totalConv = Number(data.summary.total_conversions);
  const totalTouch = Number(data.summary.total_touchpoints);
  const overallCvr = totalTouch > 0 ? Math.round((totalConv * 100) / totalTouch) : 0;
  const aov = totalConv > 0 ? Math.round(totalRev / totalConv) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Marketing"
        description="UTM atribuce, top kanály, výkonnost kampaní. Data za zvolené období."
        actions={
          <div className="flex gap-1">
            {[7, 30, 90].map((d) => (
              <Button
                key={d}
                variant={days === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDays(d)}
              >
                {d}d
              </Button>
            ))}
          </div>
        }
      />

      {/* Top stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-xs uppercase text-muted-foreground">Návštěvy</div>
            <div className="text-2xl font-bold">{totalTouch.toLocaleString('cs-CZ')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs uppercase text-muted-foreground">Konverze</div>
            <div className="text-2xl font-bold text-emerald-700">
              {totalConv.toLocaleString('cs-CZ')}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs uppercase text-muted-foreground">Conversion rate</div>
            <div className="text-2xl font-bold">{overallCvr}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-xs uppercase text-muted-foreground">Avg order value</div>
            <div className="text-2xl font-bold">{fmt(aov)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>📊 Top kanály (last-click atribuce)</CardTitle>
          <CardDescription>
            Odkud kupci přicházeli (UTM source). Konverze = paid objednávky atributable na kanál.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žádná attribution data. Nasaď UTM parametry do kampaní (`?utm_source=facebook&utm_medium=cpc`).
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Kanál</th>
                  <th className="text-right">Návštěvy</th>
                  <th className="text-right">Konverze</th>
                  <th className="text-right">CVR</th>
                  <th className="text-right">Tržby</th>
                </tr>
              </thead>
              <tbody>
                {data.channels.map((c) => {
                  const meta = CHANNEL_LABELS[c.channel] ?? {
                    icon: '❓',
                    label: c.channel,
                  };
                  return (
                    <tr key={c.channel} className="border-b">
                      <td className="py-2">
                        <span aria-hidden>{meta.icon}</span>{' '}
                        <span className="font-medium">{meta.label}</span>
                      </td>
                      <td className="text-right tabular-nums">
                        {c.touchpoints.toLocaleString('cs-CZ')}
                      </td>
                      <td className="text-right tabular-nums">
                        {c.conversions.toLocaleString('cs-CZ')}
                      </td>
                      <td className="text-right">
                        <span
                          className={
                            c.conversionRate >= 5
                              ? 'text-emerald-700 font-medium'
                              : c.conversionRate >= 2
                                ? ''
                                : 'text-muted-foreground'
                          }
                        >
                          {c.conversionRate}%
                        </span>
                      </td>
                      <td className="text-right font-semibold">{fmt(c.revenueHalire)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>📣 Top kampaně</CardTitle>
          <CardDescription>
            Konkrétní kampaně vytvořené v Tixly (email/SMS/Ads marketplace). Sent → click →
            konverze → revenue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žádné kampaně. Vytvoř první v <code>/admin/campaigns</code>.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Kampaň</th>
                  <th>UTM</th>
                  <th className="text-right">Sent</th>
                  <th className="text-right">Click</th>
                  <th className="text-right">Konverze</th>
                  <th className="text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td className="text-xs text-muted-foreground">
                      {c.utmSource ?? '—'}/{c.utmMedium ?? '—'}
                    </td>
                    <td className="text-right tabular-nums">{c.sentCount}</td>
                    <td className="text-right tabular-nums">{c.clickCount}</td>
                    <td className="text-right tabular-nums">{c.conversionCount}</td>
                    <td className="text-right font-semibold">{fmt(c.revenueHalire)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p>
          <strong>Tip:</strong> Pro správnou atribuci přidávej UTM parametry do všech kampaní:
          <br />
          <code>?utm_source=facebook&utm_medium=cpc&utm_campaign=romeo-julie-jaro</code>
          <br />
          Tixly automaticky zachytí návštěvu a pakovní attribute proti finální platbě.
        </p>
      </div>
    </div>
  );
}
