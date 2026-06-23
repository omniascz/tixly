'use client';

import { FormEvent, useEffect, useState } from 'react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TwoFactorSettings } from './TwoFactorSettings';

interface Settings {
  role: string;
  promoter: {
    id: string;
    name: string;
    email: string;
    contactEmail: string | null;
    locale: string;
  };
  branding: {
    logoUrl: string | null;
    colorHex: string | null;
    tagline: string | null;
  };
  tracking: {
    metaPixelId: string | null;
    ga4MeasurementId: string | null;
    hasCapiToken: boolean;
    hasGa4Secret: boolean;
  };
  billing: {
    bankAccount: string | null;
  };
  payout: {
    cycle: string;
    rollingReservePct: number;
    reserveReleaseDays: number;
    minPayoutHalire: number;
  };
  refundPolicy: {
    windowDays: number;
    maxPct: number;
    autoApproveUnderHalire: number;
    allowCustomerSelfRefund: boolean;
  };
}

type Tab = 'general' | 'branding' | 'tracking' | 'billing' | 'refund' | 'security';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'general', label: 'Obecné' },
  { id: 'branding', label: 'Branding' },
  { id: 'tracking', label: 'Marketing' },
  { id: 'billing', label: 'Billing & Výplaty' },
  { id: 'refund', label: 'Refund policy' },
  { id: 'security', label: 'Zabezpečení' },
];

export default function SettingsPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>('general');

  // General
  const [contactEmail, setContactEmail] = useState('');
  const [locale, setLocale] = useState('cs');

  // Branding
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandColorHex, setBrandColorHex] = useState('');
  const [brandTagline, setBrandTagline] = useState('');

  // Marketing / tracking
  const [metaPixelId, setMetaPixelId] = useState('');
  const [metaCapiToken, setMetaCapiToken] = useState('');
  const [hasCapiToken, setHasCapiToken] = useState(false);
  const [ga4MeasurementId, setGa4MeasurementId] = useState('');
  const [ga4ApiSecret, setGa4ApiSecret] = useState('');
  const [hasGa4Secret, setHasGa4Secret] = useState(false);

  // Billing
  const [bankAccount, setBankAccount] = useState('');
  const [payoutCycle, setPayoutCycle] = useState('weekly');
  const [minPayoutCzk, setMinPayoutCzk] = useState('500');

  // Refund
  const [refundWindowDays, setRefundWindowDays] = useState('14');
  const [maxRefundPct, setMaxRefundPct] = useState('100');
  const [autoApproveUnderCzk, setAutoApproveUnderCzk] = useState('0');
  const [allowSelfRefund, setAllowSelfRefund] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const r = await fetch('/api/admin/settings', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (r.ok) {
      const d = (await r.json()) as Settings;
      setData(d);
      setContactEmail(d.promoter.contactEmail ?? d.promoter.email);
      setLocale(d.promoter.locale);
      setBrandLogoUrl(d.branding.logoUrl ?? '');
      setBrandColorHex(d.branding.colorHex ?? '');
      setBrandTagline(d.branding.tagline ?? '');
      setMetaPixelId(d.tracking.metaPixelId ?? '');
      setHasCapiToken(d.tracking.hasCapiToken);
      setMetaCapiToken('');
      setGa4MeasurementId(d.tracking.ga4MeasurementId ?? '');
      setHasGa4Secret(d.tracking.hasGa4Secret);
      setGa4ApiSecret('');
      setBankAccount(d.billing.bankAccount ?? '');
      setPayoutCycle(d.payout.cycle);
      setMinPayoutCzk(String(Math.round(d.payout.minPayoutHalire / 100)));
      setRefundWindowDays(String(d.refundPolicy.windowDays));
      setMaxRefundPct(String(d.refundPolicy.maxPct));
      setAutoApproveUnderCzk(String(Math.round(d.refundPolicy.autoApproveUnderHalire / 100)));
      setAllowSelfRefund(d.refundPolicy.allowCustomerSelfRefund);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function patchAndReload(payload: Record<string, unknown>) {
    setError(null);
    setFeedback(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFeedback('Nastavení uloženo.');
      await reload();
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Načítám…</div>;
  }

  const isOwner = data.role === 'owner';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nastavení"
        description="Profil, branding, výplaty, refund policy."
      />

      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setError(null);
              setFeedback(null);
            }}
            className={`relative -mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {tab === 'general' ? (
        <Card>
          <CardHeader>
            <CardTitle>{data.promoter.name}</CardTitle>
            <CardDescription>Profil a jazyk</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void patchAndReload({ contactEmail, locale });
              }}
              className="space-y-3"
            >
              <div>
                <label className="mb-1 block text-xs font-medium">Hlavní e-mail (login)</label>
                <Input value={data.promoter.email} disabled />
                <p className="mt-1 text-xs text-muted-foreground">
                  Tento e-mail nelze změnit přes self-service.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kontaktní e-mail (zobrazí se kupcům)</label>
                <Input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Jazyk</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                >
                  <option value="cs">Čeština</option>
                  <option value="en">English</option>
                  <option value="sk">Slovenčina</option>
                  <option value="de">Deutsch</option>
                </select>
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? 'Ukládám…' : 'Uložit'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'branding' ? (
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>
              Zobrazí se kupcům na akci, v PDF lístku a v transakčních e-mailech.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void patchAndReload({
                  brandLogoUrl: brandLogoUrl || null,
                  brandColorHex: brandColorHex || null,
                  brandTagline: brandTagline || null,
                });
              }}
              className="space-y-3"
            >
              <div>
                <label className="mb-1 block text-xs font-medium">Logo URL (volitelné)</label>
                <Input
                  type="url"
                  value={brandLogoUrl}
                  onChange={(e) => setBrandLogoUrl(e.target.value)}
                  placeholder="https://..."
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Externí URL na PNG/JPG/SVG, ideálně 200×60 px transparentní pozadí.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Hlavní barva</label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={brandColorHex || '#10b981'}
                      onChange={(e) => setBrandColorHex(e.target.value)}
                      className="h-10 w-16"
                    />
                    <Input
                      type="text"
                      value={brandColorHex}
                      onChange={(e) => setBrandColorHex(e.target.value)}
                      pattern="#[0-9a-fA-F]{6}"
                      placeholder="#10b981"
                      className="flex-1 font-mono"
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Tagline</label>
                <Input
                  value={brandTagline}
                  onChange={(e) => setBrandTagline(e.target.value)}
                  placeholder="Nejlepší koncerty v Praze"
                  maxLength={200}
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? 'Ukládám…' : 'Uložit branding'}
              </Button>
            </form>

            {brandLogoUrl || brandColorHex || brandTagline ? (
              <div className="mt-6 rounded-md border bg-muted/30 p-4">
                <p className="mb-3 text-xs uppercase text-muted-foreground">Náhled</p>
                <div
                  className="rounded-md p-4 text-white"
                  style={{ backgroundColor: brandColorHex || '#10b981' }}
                >
                  <div className="flex items-center gap-3">
                    {brandLogoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={brandLogoUrl} alt="logo" className="h-10 max-w-[200px]" />
                    ) : null}
                    <div>
                      <div className="font-semibold">{data.promoter.name}</div>
                      {brandTagline ? <div className="text-xs opacity-90">{brandTagline}</div> : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'tracking' ? (
        <Card>
          <CardHeader>
            <CardTitle>Marketing pixely</CardTitle>
            <CardDescription>
              Měření konverzí přes Meta (Facebook/Instagram) a Google Analytics 4.
              Jeden pixel platí pro všechny tvé akce. Vyplň, abychom mohli posílat
              události (zobrazení, košík, nákup) do tvého reklamního účtu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                const payload: Record<string, unknown> = {
                  // '' = vymazat (plaintext IDs). undefined neposíláme.
                  metaPixelId: metaPixelId.trim(),
                  ga4MeasurementId: ga4MeasurementId.trim(),
                };
                // Secrety posíláme jen když uživatel něco napsal (write-only).
                if (metaCapiToken.trim()) payload.metaCapiToken = metaCapiToken.trim();
                if (ga4ApiSecret.trim()) payload.ga4ApiSecret = ga4ApiSecret.trim();
                void patchAndReload(payload);
              }}
              className="space-y-5"
            >
              <div className="space-y-3 rounded-md border p-3">
                <div className="text-sm font-semibold">Meta (Facebook / Instagram)</div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Pixel ID</label>
                  <Input
                    value={metaPixelId}
                    onChange={(e) => setMetaPixelId(e.target.value)}
                    placeholder="1234567890123456"
                    inputMode="numeric"
                    className="font-mono"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Najdeš v Meta Events Manageru. Jen číslice. Prázdné pole = vypnuto.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Conversions API token{' '}
                    {hasCapiToken ? (
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                        nastaveno
                      </span>
                    ) : null}
                  </label>
                  <Input
                    type="password"
                    value={metaCapiToken}
                    onChange={(e) => setMetaCapiToken(e.target.value)}
                    placeholder={hasCapiToken ? '•••••••• (ponech prázdné = beze změny)' : 'EAAB...'}
                    autoComplete="off"
                    className="font-mono"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Server-side měření (funguje i přes adblock). Ukládá se šifrovaně,
                    zpět ho nezobrazíme. Nákup se posílá přes CAPI vždy.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="text-sm font-semibold">Google Analytics 4</div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Measurement ID</label>
                  <Input
                    value={ga4MeasurementId}
                    onChange={(e) => setGa4MeasurementId(e.target.value)}
                    placeholder="G-XXXXXXXXXX"
                    className="font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    Measurement Protocol API secret{' '}
                    {hasGa4Secret ? (
                      <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                        nastaveno
                      </span>
                    ) : null}
                  </label>
                  <Input
                    type="password"
                    value={ga4ApiSecret}
                    onChange={(e) => setGa4ApiSecret(e.target.value)}
                    placeholder={hasGa4Secret ? '•••••••• (ponech prázdné = beze změny)' : ''}
                    autoComplete="off"
                    className="font-mono"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Šifrovaně. Slouží pro server-side purchase event do GA4.
                  </p>
                </div>
              </div>

              <Button type="submit" disabled={loading}>
                {loading ? 'Ukládám…' : 'Uložit tracking'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'billing' ? (
        <Card>
          <CardHeader>
            <CardTitle>Billing & Výplaty</CardTitle>
            <CardDescription>
              {isOwner
                ? 'Bankovní účet pro výplaty + cyklus.'
                : 'Jen owner může editovat. Můžeš jen prohlížet.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (!isOwner) return;
                void patchAndReload({
                  bankAccount: bankAccount || null,
                  payoutCycle,
                  minPayoutHalire: Math.round(parseFloat(minPayoutCzk) * 100),
                });
              }}
              className="space-y-3"
            >
              <div>
                <label className="mb-1 block text-xs font-medium">Bankovní účet (IBAN)</label>
                <Input
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                  placeholder="CZ65 0800 0000 0019 2000 1453"
                  disabled={!isOwner}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Cyklus výplat</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={payoutCycle}
                    onChange={(e) => setPayoutCycle(e.target.value)}
                    disabled={!isOwner}
                  >
                    <option value="daily">Denní</option>
                    <option value="weekly">Týdenní</option>
                    <option value="monthly">Měsíční</option>
                    <option value="manual">Manuální</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Minimální výplata (Kč)</label>
                  <Input
                    type="number"
                    min={0}
                    value={minPayoutCzk}
                    onChange={(e) => setMinPayoutCzk(e.target.value)}
                    disabled={!isOwner}
                    required
                  />
                </div>
              </div>
              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                <strong>Rolling reserve:</strong> {data.payout.rollingReservePct}% ·
                <strong className="ml-1">Release:</strong> {data.payout.reserveReleaseDays} dní ·
                upravuje master admin.
              </div>
              {isOwner ? (
                <Button type="submit" disabled={loading}>
                  {loading ? 'Ukládám…' : 'Uložit billing'}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'security' ? <TwoFactorSettings /> : null}

      {tab === 'refund' ? (
        <Card>
          <CardHeader>
            <CardTitle>Refund policy</CardTitle>
            <CardDescription>
              {isOwner
                ? 'Default pravidla pro vrácení peněz. Aplikují se na nové objednávky.'
                : 'Jen owner může editovat.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (!isOwner) return;
                void patchAndReload({
                  refundWindowDays: parseInt(refundWindowDays, 10),
                  maxRefundPct: parseInt(maxRefundPct, 10),
                  autoApproveUnderHalire: Math.round(parseFloat(autoApproveUnderCzk) * 100),
                  allowCustomerSelfRefund: allowSelfRefund,
                });
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Refund okno (dnů)</label>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={refundWindowDays}
                    onChange={(e) => setRefundWindowDays(e.target.value)}
                    disabled={!isOwner}
                    required
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    EU default: 14 dní (Directive 2011/83). 0 = bez refundu.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Max refund (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={maxRefundPct}
                    onChange={(e) => setMaxRefundPct(e.target.value)}
                    disabled={!isOwner}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Auto-approve do (Kč)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={autoApproveUnderCzk}
                  onChange={(e) => setAutoApproveUnderCzk(e.target.value)}
                  disabled={!isOwner}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Refundy pod tuto částku se schválí automaticky bez tvého souhlasu. 0 = vždy schválit ručně.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowSelfRefund}
                  onChange={(e) => setAllowSelfRefund(e.target.checked)}
                  disabled={!isOwner}
                  className="mt-0.5"
                />
                <span>
                  <strong>Self-service refund pro kupce</strong>
                  <span className="block text-xs text-muted-foreground">
                    Kupec může vrátit lístek sám v rámci refund okna, bez tvého souhlasu.
                  </span>
                </span>
              </label>
              {isOwner ? (
                <Button type="submit" disabled={loading}>
                  {loading ? 'Ukládám…' : 'Uložit refund policy'}
                </Button>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
