'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

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
        <a href="/admin/promo-codes" className="text-sm text-primary underline">Promo kódy (slevové kódy)</a>
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
      {/* Kolo 12: promo kódy byly dosažitelné jen přes „Vše" */}
      <div className="flex flex-wrap gap-2">
        <a href="/admin/promo-codes" className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          Promo kódy (slevové kódy)
        </a>
      </div>

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

      {/* Platform Performance Benchmarks */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader>
          <CardTitle className="text-base">Tixly platforma — výkonnostní benchmarky</CardTitle>
          <CardDescription>
            Ověřená data z Tixly ekosystému. Porovnej svůj výkon s průměrem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-background p-4 text-center">
              <div className="text-3xl font-extrabold text-primary">+200%</div>
              <div className="mt-1 text-sm font-medium">Fan engagement</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Nárůst zapojení fanoušků. Ověřeno na Jolly Joker Arena.
              </div>
            </div>
            <div className="rounded-lg border bg-background p-4 text-center">
              <div className="text-3xl font-extrabold text-emerald-600">+284%</div>
              <div className="mt-1 text-sm font-medium">Digitální skeny</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Nárůst digitálních skenů za 6+ let provozu na platformě.
              </div>
            </div>
            <div className="rounded-lg border bg-background p-4 text-center">
              <div className="text-3xl font-extrabold text-blue-600">2,5%</div>
              <div className="mt-1 text-sm font-medium">Nejnižší poplatek</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Nejnižší provize na CZ/SK trhu (PLG 5–7%, SMSticket 5%).
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            * Benchmarky vycházejí z průměru promotérů na platformě. Individuální výsledky se liší dle žánru a cílového publika.
          </p>
        </CardContent>
      </Card>

      {/* Marketing Consultant */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marketing specialisté Tixly</CardTitle>
          <CardDescription>
            Konzultace, plánování kampaní a optimalizace jako součást prémiové služby.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">📊 Analýza kampaní</div>
              <p className="mt-1 text-muted-foreground text-xs">
                Audit vašich UTM dat, identifikace top kanálů a doporučení pro realokaci budgetu.
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">🎯 Paid media plán</div>
              <p className="mt-1 text-muted-foreground text-xs">
                Tvorba strategie pro Meta, Google a TikTok reklamu zaměřené na váš žánr.
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">📧 Email & SMS workflow</div>
              <p className="mt-1 text-muted-foreground text-xs">
                Nastavení automatizovaných broadcast sekvencí (pre-sale, reminder, post-event).
              </p>
            </div>
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">📈 Reporting & attribution</div>
              <p className="mt-1 text-muted-foreground text-xs">
                Propojení pixel + CAPI + UTM do kompletního attribution modelu.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <a
              href="mailto:marketing@tixly.cz?subject=Konzultace marketing"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Požádat o konzultaci
            </a>
            <span className="text-xs text-muted-foreground">
              Odpoví do 1 pracovního dne. Nezávazné.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
