'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EventSettings {
  id: string;
  title: string;
  currency: string;
  queueEnabled: boolean;
  queueMaxConcurrent: number;
  insuranceEnabled: boolean;
  insurancePct: number;
  // CZ/SK launch fields (migrace 265)
  refundDeadlineDays: number | null;
  refundFeePct: number | null;
  refundFeeMinHalire: number | null;
  qrPolicy: 'static_allowed' | 'rotating_24h' | 'rotating_only' | 'photo_required';
  vatCategory: 'standard' | 'cultural' | 'food_beverage' | 'merchandise' | 'reduced';
  // P1.5 + P1.8 toggles (anti-bot / verified fan gates)
  verifiedFanEnabled?: boolean;
  requiresOtpValidation?: boolean;
}

const QR_POLICY_LABELS: Record<EventSettings['qrPolicy'], { title: string; desc: string }> = {
  static_allowed: {
    title: '🟢 Standard — PDF + mobile QR oboje funguje',
    desc: 'Default. PDF s statickým QR a mobile rotující QR — scanner přijme oba. Vhodné pro 99 % akcí.',
  },
  rotating_24h: {
    title: '🟡 Anti-share — PDF zruší 24h před akcí',
    desc: '24 hodin před začátkem PDF přestane fungovat. Scanner vynutí rotující mobile QR. Brání forwarding screenshotu.',
  },
  rotating_only: {
    title: '🔴 Mobile-only — jen rotující QR',
    desc: 'PDF se nevygeneruje, kupec dostane jen URL s rotujícím QR. Pro high-demand akce (festivaly, koncerty).',
  },
  photo_required: {
    title: '🔒 Photo + rotating — Tier-1 anti-counterfeiting',
    desc: 'Rotující QR + fotokontrola u brány (manuálně). Pro VIP zóny, akreditované festivaly.',
  },
};

const VAT_CATEGORY_LABELS: Record<EventSettings['vatCategory'], { title: string; ratesCz: string; ratesSr: string }> = {
  standard: { title: 'Standardní sazba', ratesCz: '21 %', ratesSr: '23 %' },
  cultural: { title: 'Kulturní akce (default ticketing)', ratesCz: '10 %', ratesSr: '5 %' },
  food_beverage: { title: 'F&B (občerstvení)', ratesCz: '12 %', ratesSr: '19 %' },
  merchandise: { title: 'Merchandise (zboží)', ratesCz: '21 %', ratesSr: '23 %' },
  reduced: { title: 'Snížená sazba (alias kulturní)', ratesCz: '10 %', ratesSr: '5 %' },
};

interface PaymentPlan {
  id: string;
  name: string;
  deposit_pct: number;
  installments_count: number;
  interval_days: number;
  active: boolean;
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

export default function EventSettingsPage() {
  const params = useParams();
  const id = String(params.id);

  const [data, setData] = useState<EventSettings | null>(null);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Plan form
  const [planName, setPlanName] = useState('');
  const [depositPct, setDepositPct] = useState('25');
  const [installmentsCount, setInstallmentsCount] = useState('3');
  const [intervalDays, setIntervalDays] = useState('30');

  useEffect(() => {
    void load();
    async function load() {
      try {
        const [evRes, plansRes] = await Promise.all([
          authFetch(`/api/admin/events/${id}`),
          authFetch(`/api/admin/events/${id}/payment-plans`),
        ]);
        if (!evRes.ok) {
          setError(`Nelze načíst akci (${evRes.status})`);
          return;
        }
        setData((await evRes.json()) as EventSettings);
        if (plansRes.ok) {
          setPlans((((await plansRes.json()) as { plans: PaymentPlan[] }).plans) ?? []);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [id]);

  async function saveSettings(patch: Partial<EventSettings>) {
    if (!data) return;
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setData({ ...data, ...patch });
      setFeedback('Uloženo.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function createPlan() {
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${id}/payment-plans`, {
        method: 'POST',
        body: JSON.stringify({
          name: planName,
          depositPct: Number(depositPct),
          installmentsCount: Number(installmentsCount),
          intervalDays: Number(intervalDays),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      // Reload plans
      const plansRes = await authFetch(`/api/admin/events/${id}/payment-plans`);
      setPlans((((await plansRes.json()) as { plans: PaymentPlan[] }).plans) ?? []);
      setPlanName('');
      setFeedback('Plán přidán.');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!data && !error) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }
  if (!data) {
    return <p className="text-sm text-rose-700">Chyba: {error}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Nastavení akce — ${data.title}`}
        description="Pokročilé možnosti: virtuální fronta, pojistka zrušení, platební plány."
        actions={
          <Link href={`/admin/events/${id}/edit`}>
            <Button variant="outline" size="sm">
              ← Zpět na editaci
            </Button>
          </Link>
        }
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Virtuální fronta</CardTitle>
          <CardDescription>
            Zapni pro on-sale momenty s vysokou poptávkou. Buyer projde čekárnou, server ho admituje
            postupně podle volných slotů.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.queueEnabled}
              onChange={(e) => saveSettings({ queueEnabled: e.target.checked })}
              disabled={saving}
            />
            Zapnout frontu pro tuto akci
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Max současných kupců na pokladně
            </label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={data.queueMaxConcurrent}
              onChange={(e) =>
                setData({ ...data, queueMaxConcurrent: Number(e.target.value) })
              }
              onBlur={() => saveSettings({ queueMaxConcurrent: data.queueMaxConcurrent })}
              disabled={saving || !data.queueEnabled}
              className="max-w-32"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Demo: ~100. Real festival on-sale: 500–2000 dle DB scaling.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* P1.5 + P1.8 — Anti-bot / Verified Fan gates */}
      <Card>
        <CardHeader>
          <CardTitle>Anti-bot gates</CardTitle>
          <CardDescription>
            Volitelné gates v checkoutu pro top-poptávkové akce (Helena
            Vondráčková, derby, festival announcement). Zapni jednotlivě —
            mohou způsobit drop conversion u běžných akcí.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.verifiedFanEnabled ?? false}
              onChange={(e) =>
                saveSettings({ verifiedFanEnabled: e.target.checked })
              }
              disabled={saving}
            />
            <span>
              <span className="font-medium">Verified Fan presale</span>
              <span className="block text-xs text-muted-foreground">
                Jen schválení fanoušci s PSL-xxxx kódem mohou koupit. Admin
                schvaluje na záložce Verified Fan. Pattern: Ticketmaster
                Verified Fan.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.requiresOtpValidation ?? false}
              onChange={(e) =>
                saveSettings({ requiresOtpValidation: e.target.checked })
              }
              disabled={saving}
            />
            <span>
              <span className="font-medium">SMS OTP ověření</span>
              <span className="block text-xs text-muted-foreground">
                Kupec musí ověřit telefon SMS kódem před nákupem. Anti-bot
                opatření (IT Legge anti-bagarinaggio pattern). Bez Twilio
                env keys SMS se nepošle reálně (jen mock).
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {/* CZ/SK launch — Refund policy per-event */}
      <Card>
        <CardHeader>
          <CardTitle>Refund pravidla</CardTitle>
          <CardDescription>
            Kdy a za jakých podmínek může kupec sám vrátit lístek. Pokud nevyplníš, použije se
            platform default (7 dní před akcí, 5 % fee, min 30 Kč / 1,20 EUR).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Deadline (dní před akcí)
              </label>
              <Input
                type="number"
                min={0}
                max={90}
                value={data.refundDeadlineDays ?? ''}
                placeholder="default 7"
                onChange={(e) =>
                  setData({
                    ...data,
                    refundDeadlineDays: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                onBlur={() => saveSettings({ refundDeadlineDays: data.refundDeadlineDays })}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                0 = žádný refund. Prázdné = platform default.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Fee (% z částky)
              </label>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={data.refundFeePct !== null ? data.refundFeePct / 100 : ''}
                placeholder="default 5 %"
                onChange={(e) => {
                  const pct = e.target.value === '' ? null : Number(e.target.value);
                  setData({
                    ...data,
                    refundFeePct: pct === null ? null : Math.round(pct * 100),
                  });
                }}
                onBlur={() => saveSettings({ refundFeePct: data.refundFeePct })}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Strhneme z refundu jako poplatek. Default 5 %.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Min fee ({data.currency === 'EUR' ? 'cents' : 'haléře'})
              </label>
              <Input
                type="number"
                min={0}
                value={data.refundFeeMinHalire ?? ''}
                placeholder={data.currency === 'EUR' ? 'default 120' : 'default 3000'}
                onChange={(e) =>
                  setData({
                    ...data,
                    refundFeeMinHalire: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                onBlur={() => saveSettings({ refundFeeMinHalire: data.refundFeeMinHalire })}
                disabled={saving}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Minimum i když % vyjde méně. Default 30 Kč / 1,20 EUR.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CZ/SK launch — QR padělání policy */}
      <Card>
        <CardHeader>
          <CardTitle>QR kód — anti-padělání</CardTitle>
          <CardDescription>
            Jaký typ QR generujeme a co scanner akceptuje. Default „Standard" stačí pro většinu akcí.
            Pro festivaly nebo high-demand zvol přísnější úroveň.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(Object.keys(QR_POLICY_LABELS) as EventSettings['qrPolicy'][]).map((p) => (
            <label
              key={p}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ${
                data.qrPolicy === p ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
              }`}
            >
              <input
                type="radio"
                name="qrPolicy"
                value={p}
                checked={data.qrPolicy === p}
                onChange={() => saveSettings({ qrPolicy: p })}
                disabled={saving}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium">{QR_POLICY_LABELS[p].title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {QR_POLICY_LABELS[p].desc}
                </div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      {/* CZ/SK launch — VAT category */}
      <Card>
        <CardHeader>
          <CardTitle>DPH kategorie</CardTitle>
          <CardDescription>
            Určuje sazbu DPH v účtence a vyúčtování. Default „Kulturní akce" je správný pro většinu
            ticketingu. CZ a SR mají různé sazby — vybírá se podle země promotéra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(VAT_CATEGORY_LABELS) as EventSettings['vatCategory'][]).map((c) => (
              <label
                key={c}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition ${
                  data.vatCategory === c ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                }`}
              >
                <input
                  type="radio"
                  name="vatCategory"
                  value={c}
                  checked={data.vatCategory === c}
                  onChange={() => saveSettings({ vatCategory: c })}
                  disabled={saving}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium">{VAT_CATEGORY_LABELS[c].title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    🇨🇿 {VAT_CATEGORY_LABELS[c].ratesCz} · 🇸🇰 {VAT_CATEGORY_LABELS[c].ratesSr}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pojistka zrušení (refund insurance)</CardTitle>
          <CardDescription>
            Buyer si na checkoutu zaškrtne add-on. Po pojistné události může uplatnit refund přes
            mock_insurer (produkce: XCover / Booking Protect).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={data.insuranceEnabled}
              onChange={(e) => saveSettings({ insuranceEnabled: e.target.checked })}
              disabled={saving}
            />
            Nabízet pojistku zrušení
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Pojistné v % z ceny objednávky
            </label>
            <Input
              type="number"
              min={0}
              max={50}
              value={data.insurancePct}
              onChange={(e) => setData({ ...data, insurancePct: Number(e.target.value) })}
              onBlur={() => saveSettings({ insurancePct: data.insurancePct })}
              disabled={saving || !data.insuranceEnabled}
              className="max-w-24"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Standard: 6–10 %. Limit: 0–50 %.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Platební plány</CardTitle>
          <CardDescription>
            Buyer si na checkoutu vybere plán: 100 % zaplaceno hned, nebo X % záloha + N splátek
            každých D dní.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">Zatím žádný plán.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Název</th>
                  <th>Záloha</th>
                  <th>Splátky</th>
                  <th>Interval</th>
                  <th>Aktivní</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2">{p.name}</td>
                    <td>{p.deposit_pct} %</td>
                    <td>{p.installments_count}×</td>
                    <td>{p.interval_days} dní</td>
                    <td>{p.active ? 'Ano' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="rounded-md border bg-muted/30 p-3">
            <h4 className="mb-2 text-sm font-semibold">Přidat plán</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Input
                placeholder="Název (např. 25 % + 3×)"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
              />
              <Input
                type="number"
                min={0}
                max={100}
                value={depositPct}
                onChange={(e) => setDepositPct(e.target.value)}
                placeholder="Záloha %"
              />
              <Input
                type="number"
                min={0}
                max={24}
                value={installmentsCount}
                onChange={(e) => setInstallmentsCount(e.target.value)}
                placeholder="Splátky"
              />
              <Input
                type="number"
                min={1}
                max={365}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
                placeholder="Dní"
              />
            </div>
            <Button
              size="sm"
              className="mt-2"
              onClick={createPlan}
              disabled={!planName.trim()}
            >
              Přidat plán
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
