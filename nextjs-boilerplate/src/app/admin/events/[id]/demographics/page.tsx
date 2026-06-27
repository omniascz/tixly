'use client';

/**
 * /admin/events/[id]/demographics — vizuální analýza publika
 *
 * Zobrazuje aggregovaná demografická data kupujících:
 *   věkové skupiny, pohlaví, geografie (top města/země).
 * Privacy-safe: žádné individual identifiers, K-anonymity ≥ 5.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Users, MapPin, TrendingUp, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Demographics {
  totalBuyers: number;
  sampleAdequate: boolean;
  minimumSampleSize: number;
  age: Record<string, number> | null;
  gender: { male: number; female: number; other: number; unknown: number } | null;
  geography: { country: string | null; city: string | null; count: number }[];
  privacy_note: string;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 100);
}

interface BarProps { label: string; value: number; total: number; color: string }

function Bar({ label, value, total, color }: BarProps) {
  const p = pct(value, total);
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 flex-shrink-0 text-right text-xs text-muted-foreground">{label}</div>
      <div className="flex-1 rounded-full bg-muted h-5 overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${p}%` }}
        />
      </div>
      <div className="w-16 text-xs text-muted-foreground">
        {value} <span className="text-muted-foreground/60">({p}%)</span>
      </div>
    </div>
  );
}

const COUNTRY_FLAG: Record<string, string> = {
  CZ: '🇨🇿', SK: '🇸🇰', DE: '🇩🇪', AT: '🇦🇹', PL: '🇵🇱', HU: '🇭🇺',
  GB: '🇬🇧', US: '🇺🇸', FR: '🇫🇷', NL: '🇳🇱', SE: '🇸🇪', RO: '🇷🇴',
};

export default function DemographicsPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;
  const [data, setData] = useState<Demographics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void authFetch(`/api/admin/events/${eventId}/demographics`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData((await res.json()) as Demographics);
      })
      .catch((e: Error) => setError(e.message));
  }, [eventId]);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }

  const ageKeys = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;
  const ageColors = [
    'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  ];
  const ageKnown = data.age
    ? ageKeys.reduce((s, k) => s + (data.age![k] ?? 0), 0)
    : 0;

  const genderTotal = data.gender
    ? data.gender.male + data.gender.female + data.gender.other + data.gender.unknown
    : 0;

  const topCities = data.geography.slice(0, 10);
  const maxCityCount = Math.max(1, ...topCities.map((g) => g.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Demografie publika"
        description="Věk, pohlaví, geografie kupujících. Aggregated data — žádné individuální identifikátory."
      />

      {/* Sample warning */}
      {!data.sampleAdequate && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Nedostatek dat</strong> — {data.totalBuyers} kupujících (minimum pro zobrazení: {data.minimumSampleSize}).
          Data se zobrazí po dosažení minimálního vzorku.
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{data.totalBuyers.toLocaleString('cs-CZ')}</div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Users className="h-3 w-3" /> Unikátní kupující
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">{data.geography.length}</div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center justify-center gap-1">
              <MapPin className="h-3 w-3" /> Místa původu
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold">
              {ageKnown > 0 && data.age
                ? (() => {
                    const weighted = ageKeys.reduce((sum, k) => {
                      const midpoints: Record<string, number> = { '18-24': 21, '25-34': 29.5, '35-44': 39.5, '45-54': 49.5, '55+': 60 };
                      return sum + (data.age![k] ?? 0) * midpoints[k];
                    }, 0);
                    return Math.round(weighted / ageKnown);
                  })()
                : '—'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground flex items-center justify-center gap-1">
              <TrendingUp className="h-3 w-3" /> Průměrný věk (odhad)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Věkové skupiny */}
      {data.age && data.sampleAdequate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Věkové skupiny</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ageKeys.map((k, i) => (
              <Bar
                key={k}
                label={k}
                value={data.age![k] ?? 0}
                total={ageKnown}
                color={ageColors[i]}
              />
            ))}
            {(data.age.unknown ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                + {data.age.unknown} kupujících bez roku narození (nezahrnuto)
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pohlaví */}
      {data.gender && data.sampleAdequate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Pohlaví</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Bar label="Muži" value={data.gender.male} total={genderTotal} color="bg-blue-500" />
            <Bar label="Ženy" value={data.gender.female} total={genderTotal} color="bg-rose-400" />
            {data.gender.other > 0 && (
              <Bar label="Jiné" value={data.gender.other} total={genderTotal} color="bg-violet-400" />
            )}
            {data.gender.unknown > 0 && (
              <p className="text-xs text-muted-foreground">
                + {data.gender.unknown} kupujících bez pohlaví v profilu
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Geografie */}
      {topCities.length > 0 && data.sampleAdequate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Top lokality</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topCities.map((g, i) => {
                const flag = g.country ? (COUNTRY_FLAG[g.country] ?? '🌍') : '🌍';
                const barPct = Math.round((g.count / maxCityCount) * 100);
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="w-5 text-center text-sm">{flag}</span>
                    <div className="w-32 flex-shrink-0 truncate text-xs">
                      {g.city ?? g.country ?? 'Neznámé'}
                    </div>
                    <div className="flex-1 overflow-hidden rounded-full bg-muted h-4">
                      <div
                        className="h-full bg-primary/60 transition-all duration-500"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <div className="w-10 text-right text-xs text-muted-foreground">{g.count}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Privacy note */}
      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
        <span>{data.privacy_note}</span>
      </div>
    </div>
  );
}
