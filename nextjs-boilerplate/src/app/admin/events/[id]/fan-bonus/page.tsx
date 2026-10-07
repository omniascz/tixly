'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Settings {
  fan_bonus_enabled: boolean;
  fan_bonus_pct: number;
}
interface Stats {
  total_issued: number;
  total_earned_halire: number;
  active_count: number;
  total_redeemed_halire: number;
}

const fmt = (h: number) =>
  `${(h / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Kč`;

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function FanBonusPage(): JSX.Element {
  const { id: eventId } = useParams<{ id: string }>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pctInput, setPctInput] = useState('2.50');

  async function load() {
    setLoading(true);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/fan-bonus`);
      if (r.ok) {
        const d = await r.json() as { settings: Settings; stats: Stats };
        setSettings(d.settings);
        setStats(d.stats);
        setPctInput(String(d.settings.fan_bonus_pct));
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [eventId]);

  async function save(patch: Partial<Settings>) {
    setSaving(true);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/fan-bonus`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        const d = await r.json() as { settings: Settings };
        setSettings(d.settings);
        setPctInput(String(d.settings.fan_bonus_pct));
      }
    } finally { setSaving(false); }
  }

  if (loading || !settings) {
    return <p className="p-6 text-sm text-muted-foreground">Načítám…</p>;
  }

  const redemptionRate = stats && stats.total_earned_halire > 0
    ? ((stats.total_redeemed_halire / stats.total_earned_halire) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <PageHeader
        title="FanBonus"
        description="Cashback 2–3 % z ceny vstupenky — kupující dostane kód emailem a uplatní ho při příštím nákupu."
      />

      {/* Info */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>Jak FanBonus funguje:</strong> Po úspěšném nákupu kupující automaticky obdrží emailem
        voucher kód (formát <code className="bg-blue-100 px-1 rounded">FB-XXXX-XXXX</code>) v hodnotě{' '}
        <strong>{settings.fan_bonus_pct} % ceny objednávky</strong>.
        Kód platí 12 měsíců a lze ho zadat jako <em>voucherCode</em> při jakémkoli příštím nákupu na Tixly.
        Náklad nese platforma, ne promotér.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settings */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Nastavení</CardTitle>
                <Badge variant={settings.fan_bonus_enabled ? 'default' : 'secondary'}>
                  {settings.fan_bonus_enabled ? 'Aktivní' : 'Neaktivní'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Pct slider */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Výše cashbacku
                  <span className="ml-2 text-base font-bold text-primary">{pctInput} %</span>
                </label>
                <input
                  type="range"
                  min={2} max={3} step={0.25}
                  value={pctInput}
                  onChange={(e) => setPctInput(e.target.value)}
                  onMouseUp={() => void save({ fan_bonus_pct: parseFloat(pctInput) })}
                  onTouchEnd={() => void save({ fan_bonus_pct: parseFloat(pctInput) })}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>2 % (min.)</span>
                  <span>2,5 % (výchozí)</span>
                  <span>3 % (max.)</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Vstupenka za 500 Kč → bonus{' '}
                  <strong>{(500 * parseFloat(pctInput) / 100).toFixed(0)} Kč</strong>
                </p>
              </div>

              {/* Enable/disable */}
              <Button
                onClick={() => void save({ fan_bonus_enabled: !settings.fan_bonus_enabled })}
                disabled={saving}
                variant={settings.fan_bonus_enabled ? 'outline' : 'default'}
                className="w-full"
              >
                {settings.fan_bonus_enabled ? 'Deaktivovat FanBonus' : '💰 Aktivovat FanBonus'}
              </Button>

              {settings.fan_bonus_enabled && (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
                  ✓ Aktivní — kupující po nákupu dostane email s FanBonus kódem.
                  Kód platí 12 měsíců na celé platformě Tixly.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Stats */}
        <Card>
          <CardHeader><CardTitle>Statistika (tato akce)</CardTitle></CardHeader>
          <CardContent>
            {!stats || stats.total_issued === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Žádné bonusy zatím nevydány.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-2xl font-bold">{stats.total_issued}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Vydaných bonusů</p>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-2xl font-bold">{stats.active_count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Nevyčerpaných</p>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-lg font-bold">{fmt(stats.total_earned_halire)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Celkem vydáno</p>
                </div>
                <div className="rounded-lg bg-muted p-3 text-center">
                  <p className="text-lg font-bold">{fmt(stats.total_redeemed_halire)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Uplatněno ({redemptionRate} %)</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* How it works detail */}
      <Card>
        <CardHeader><CardTitle>Průběh pro kupujícího</CardTitle></CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            {[
              { n: '1', text: 'Kupující zaplatí vstupenku na Tixly.' },
              { n: '2', text: `Po dokončení platby systém automaticky vydá FanBonus voucher (FB-XXXX-XXXX) v hodnotě ${settings.fan_bonus_pct} % z ceny.` },
              { n: '3', text: 'Kupující obdrží kód emailem spolu s vstupenkou (v confirmation emailu).' },
              { n: '4', text: 'Při příštím nákupu na Tixly zadá kód do pole „Slevový kód / voucher" a sleva se odečte z ceny.' },
              { n: '5', text: 'Kód platí 12 měsíců od vydání. Pokud ho nevyčerpá najednou, zůstatek zůstane zachován.' },
            ].map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                  {s.n}
                </span>
                <span className="text-muted-foreground">{s.text}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
