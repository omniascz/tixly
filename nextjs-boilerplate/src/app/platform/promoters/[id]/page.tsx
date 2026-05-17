'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PromoterDetail {
  id: string;
  name: string;
  slug: string | null;
  email: string;
  contact_email: string | null;
  status: 'pending' | 'active' | 'suspended';
  locale: string;
  company_ico: string | null;
  company_dic: string | null;
  company_address: string | null;
  bank_account: string | null;
  vat_payer: boolean;
  vat_rate_pct: number;
  brand_logo_url: string | null;
  brand_color_hex: string | null;
  brand_tagline: string | null;
  kyc_status: 'draft' | 'submitted' | 'approved' | 'rejected';
  kyc_submitted_at: string | null;
  kyc_reviewed_at: string | null;
  kyc_rejection_reason: string | null;
  ares_verified_at: string | null;
  ares_data: Record<string, unknown> | null;
  country: 'CZ' | 'SR';
  primary_currency: 'CZK' | 'EUR';
  tier: 1 | 2 | 3 | 4;
  tier_locked: boolean;
  chargeback_holdback_pct: number | null;
  chargeback_holdback_days: number | null;
  created_at: string;
  updated_at: string;
}

interface FeeSchedule {
  percentage_fee: number;
  buyer_fee_halire: number;
  currency: string;
  override_reason: string | null;
}

interface Member {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

interface EventRow {
  id: string;
  title: string;
  status: string;
  date_start: string;
  created_at: string;
}

interface PromoterDocument {
  id: string;
  doc_type: string;
  file_url: string;
  uploaded_at: string;
}

interface Response {
  promoter: PromoterDetail;
  members: Member[];
  recentEvents: EventRow[];
  documents: PromoterDocument[];
  feeSchedules: FeeSchedule[];
}

export default function PromoterDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const res = await fetch(`/api/platform/promoters/${params.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as Response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void load(); }, [params.id]);

  async function action(kind: 'approve' | 'suspend') {
    if (kind === 'suspend' && !confirm('Pozastavit promotéra? Nebude moci vytvářet nové akce ani prodávat.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/platform/promoters/${params.id}/${kind}`, { method: 'POST' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Link href="/platform/promoters" className="text-sm text-primary hover:underline">
          ← Zpět na seznam
        </Link>
        {error ? (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
        ) : (
          <p className="text-sm text-muted-foreground">Načítám…</p>
        )}
      </div>
    );
  }

  const p = data.promoter;
  const statusColors = {
    pending: 'bg-amber-100 text-amber-800',
    active: 'bg-emerald-100 text-emerald-800',
    suspended: 'bg-rose-100 text-rose-800',
  };
  const kycColors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    submitted: 'bg-blue-100 text-blue-800',
    approved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/promoters" className="text-sm text-primary hover:underline">
          ← Zpět na seznam
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{p.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${statusColors[p.status]}`}>
                {p.status}
              </span>
              <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${kycColors[p.kyc_status]}`}>
                KYC: {p.kyc_status}
              </span>
              {p.slug && <code className="rounded bg-muted px-1">{p.slug}</code>}
              {' · '}vytvořeno {new Date(p.created_at).toLocaleDateString('cs-CZ')}
            </p>
          </div>
          <div className="flex gap-2">
            {p.status !== 'active' && (
              <Button onClick={() => action('approve')} disabled={busy}>
                ✓ Schválit
              </Button>
            )}
            {p.status !== 'suspended' && (
              <Button variant="outline" onClick={() => action('suspend')} disabled={busy}>
                ⏸ Pozastavit
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      )}

      <CzSkSettingsCard
        promoter={p}
        activeFee={data.feeSchedules[0] ?? null}
        onUpdated={() => void load()}
      />


      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Kontakty</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Hlavní email">{p.email}</Field>
            <Field label="Kontaktní email">{p.contact_email ?? '—'}</Field>
            <Field label="Locale">{p.locale}</Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Firma / fakturace</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="IČO">
              {p.company_ico ?? '—'}
              {p.ares_verified_at && (
                <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                  ✓ ARES ověřeno
                </span>
              )}
            </Field>
            <Field label="DIČ">{p.company_dic ?? '—'}</Field>
            <Field label="Adresa">{p.company_address ?? '—'}</Field>
            <Field label="Bankovní účet">{p.bank_account ?? '—'}</Field>
            <Field label="VAT plátce">
              {p.vat_payer ? `Ano (${p.vat_rate_pct}%)` : 'Ne'}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>KYC</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Stav">
              <span className={`rounded-full px-2 py-0.5 text-xs ${kycColors[p.kyc_status]}`}>
                {p.kyc_status}
              </span>
            </Field>
            <Field label="Odesláno">
              {p.kyc_submitted_at ? new Date(p.kyc_submitted_at).toLocaleString('cs-CZ') : '—'}
            </Field>
            <Field label="Posouzeno">
              {p.kyc_reviewed_at ? new Date(p.kyc_reviewed_at).toLocaleString('cs-CZ') : '—'}
            </Field>
            {p.kyc_rejection_reason && (
              <Field label="Důvod zamítnutí">
                <span className="text-rose-800">{p.kyc_rejection_reason}</span>
              </Field>
            )}
            <p className="pt-2 text-xs text-muted-foreground">
              Detailní KYC kontrola →{' '}
              <Link href="/platform/kyc" className="text-primary hover:underline">
                /platform/kyc
              </Link>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="Tagline">{p.brand_tagline ?? '—'}</Field>
            <Field label="Barva">
              {p.brand_color_hex ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-4 w-6 rounded border"
                    style={{ background: p.brand_color_hex }}
                  />
                  {p.brand_color_hex}
                </span>
              ) : '—'}
            </Field>
            <Field label="Logo">
              {p.brand_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.brand_logo_url} alt="logo" className="mt-1 h-12 rounded" />
              ) : '—'}
            </Field>
          </CardContent>
        </Card>
      </div>

      {p.ares_data && (
        <Card>
          <CardHeader>
            <CardTitle>ARES data</CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                {p.ares_verified_at ? `Ověřeno ${new Date(p.ares_verified_at).toLocaleDateString('cs-CZ')}` : 'Detail'}
              </summary>
              <pre className="mt-2 overflow-auto rounded bg-muted/50 p-2 text-[11px]">
                {JSON.stringify(p.ares_data, null, 2)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Členové ({data.members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádní členové</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Email</th>
                  <th>Jméno</th>
                  <th>Role</th>
                  <th>Přidán</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.user_id} className="border-b">
                    <td className="py-2">{m.email}</td>
                    <td>{m.name ?? '—'}</td>
                    <td><code className="rounded bg-muted px-1 text-xs">{m.role}</code></td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(m.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Poslední akce ({data.recentEvents.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné akce</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Status</th>
                  <th>Datum konání</th>
                  <th>Vytvořeno</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="py-2">{e.title}</td>
                    <td><code className="rounded bg-muted px-1 text-xs">{e.status}</code></td>
                    <td className="text-xs">{new Date(e.date_start).toLocaleString('cs-CZ')}</td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString('cs-CZ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {data.documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dokumenty ({data.documents.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Typ</th>
                  <th>Soubor</th>
                  <th>Nahráno</th>
                </tr>
              </thead>
              <tbody>
                {data.documents.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-2"><code className="rounded bg-muted px-1 text-xs">{d.doc_type}</code></td>
                    <td>
                      <a href={d.file_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Otevřít →
                      </a>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(d.uploaded_at).toLocaleString('cs-CZ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CzSkSettingsCard({
  promoter,
  activeFee,
  onUpdated,
}: {
  promoter: PromoterDetail;
  activeFee: FeeSchedule | null;
  onUpdated: () => void;
}) {
  const [country, setCountry] = useState<'CZ' | 'SR'>(promoter.country);
  const [currency, setCurrency] = useState<'CZK' | 'EUR'>(promoter.primary_currency);
  const [tier, setTier] = useState<number>(promoter.tier);
  const [holdbackPct, setHoldbackPct] = useState<string>(
    promoter.chargeback_holdback_pct?.toString() ?? '',
  );
  const [holdbackDays, setHoldbackDays] = useState<string>(
    promoter.chargeback_holdback_days?.toString() ?? '',
  );
  const [feePct, setFeePct] = useState<string>(
    activeFee ? (activeFee.percentage_fee / 100).toString() : '',
  );
  const [buyerFee, setBuyerFee] = useState<string>(
    activeFee ? (activeFee.buyer_fee_halire / 100).toString() : '',
  );
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const body: Record<string, unknown> = {
        country,
        primaryCurrency: currency,
        tier,
        chargebackHoldbackPct: holdbackPct === '' ? null : Number(holdbackPct),
        chargebackHoldbackDays: holdbackDays === '' ? null : Number(holdbackDays),
      };
      if (feePct !== '' && buyerFee !== '') {
        body.feePctBps = Math.round(Number(feePct) * 100);
        body.buyerFeeHalire = Math.round(Number(buyerFee) * 100);
        body.feeCurrency = currency;
        body.feeOverrideReason = reason || undefined;
      }
      const res = await fetch(`/api/platform/promoters/${promoter.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setFeedback(`Chyba: ${j.error ?? res.status}`);
        return;
      }
      setFeedback('Uloženo.');
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  const tierDefault: Record<number, { pct: number; days: number }> = {
    1: { pct: 5, days: 90 },
    2: { pct: 3, days: 60 },
    3: { pct: 0, days: 0 },
    4: { pct: 0, days: 0 },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>CZ/SK launch — tržiště + sazby</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Země (určuje DPH sazby)
            </label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value as 'CZ' | 'SR')}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="CZ">🇨🇿 Česká republika</option>
              <option value="SR">🇸🇰 Slovenská republika</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Primární měna
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as 'CZK' | 'EUR')}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="CZK">CZK (koruna)</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Tier (1-4)
            </label>
            <select
              value={tier}
              onChange={(e) => setTier(Number(e.target.value))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value={1}>1 — Nový (manual approve)</option>
              <option value={2}>2 — Ověřený (auto)</option>
              <option value={3}>3 — Premium (nižší fee)</option>
              <option value={4}>4 — Enterprise (custom)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Holdback % (bps, prázdné = tier default)
            </label>
            <Input
              type="number"
              min={0}
              max={2000}
              value={holdbackPct}
              placeholder={`tier ${tier}: ${tierDefault[tier]?.pct ?? 5}%`}
              onChange={(e) => setHoldbackPct(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Holdback dní (prázdné = tier default)
            </label>
            <Input
              type="number"
              min={0}
              max={365}
              value={holdbackDays}
              placeholder={`tier ${tier}: ${tierDefault[tier]?.days ?? 90}d`}
              onChange={(e) => setHoldbackDays(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <h4 className="mb-2 text-sm font-semibold">Provize (fee override)</h4>
          <p className="mb-3 text-xs text-muted-foreground">
            Vytvoří nový aktivní fee_schedule. Stávající aktivní (pro {currency}) bude deaktivován.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                % z prodeje
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={feePct}
                placeholder="např. 5"
                onChange={(e) => setFeePct(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Buyer fee ({currency === 'EUR' ? '€' : 'Kč'} per objednávka)
              </label>
              <Input
                type="number"
                min={0}
                step={0.1}
                value={buyerFee}
                placeholder="např. 10"
                onChange={(e) => setBuyerFee(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Důvod (audit)
              </label>
              <Input
                value={reason}
                placeholder="např. kulturní dům, charita, objem >1M"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>
        </div>

        {activeFee ? (
          <p className="text-xs text-muted-foreground">
            Aktuální aktivní fee: {(activeFee.percentage_fee / 100).toFixed(1)} % +{' '}
            {(activeFee.buyer_fee_halire / 100).toFixed(2)} {activeFee.currency}/obj.
            {activeFee.override_reason ? ` · ${activeFee.override_reason}` : ''}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Žádný aktivní fee_schedule. Bude použit platform default 5 %.
          </p>
        )}

        <div className="flex items-center justify-between">
          <Button onClick={save} disabled={saving}>
            {saving ? 'Ukládám…' : 'Uložit změny'}
          </Button>
          {feedback ? <span className="text-sm text-emerald-700">{feedback}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2">
      <span className="text-xs uppercase text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
