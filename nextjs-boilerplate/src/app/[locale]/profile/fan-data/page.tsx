'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Správa přenosného fanouškovského profilu (B7) — fanoušek VLASTNÍ a ovládá svá data.
 * Nad /api/buyer/fan-profile (GET/PUT).
 */

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

interface Profile {
  displayName: string | null;
  favoriteGenres: string[];
  accessibilityPrefs: Record<string, boolean>;
  marketingConsent: Record<string, boolean>;
  portable: boolean;
}

const ACC_OPTIONS: { key: string; label: string }[] = [
  { key: 'stepFree', label: 'Bezbariérový přístup' },
  { key: 'captions', label: 'Titulky / přepis' },
  { key: 'sensory', label: 'Sensory-friendly (klidnější prostředí)' },
  { key: 'companion', label: 'Místo pro doprovod' },
];
const CONSENT_OPTIONS: { key: string; label: string }[] = [
  { key: 'email', label: 'E-mailový newsletter' },
  { key: 'sms', label: 'SMS upozornění' },
  { key: 'profiling', label: 'Personalizace nabídek (profilování)' },
];

export default function FanDataPage() {
  const [p, setP] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [genresText, setGenresText] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await authFetch('/api/buyer/fan-profile');
        const j = (await res.json()) as { profile: Profile };
        setP(j.profile);
        setGenresText(j.profile.favoriteGenres.join(', '));
      } catch {
        setMsg('Nepodařilo se načíst profil.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toggle(field: 'accessibilityPrefs' | 'marketingConsent', key: string, val: boolean) {
    setP((prev) => (prev ? { ...prev, [field]: { ...prev[field], [key]: val } } : prev));
  }

  async function save() {
    if (!p) return;
    setSaving(true);
    setMsg(null);
    try {
      const genres = genresText.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
      const res = await authFetch('/api/buyer/fan-profile', {
        method: 'PUT',
        body: JSON.stringify({ ...p, favoriteGenres: genres }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { message?: string };
        setMsg(j.message ?? 'Uložení selhalo.');
        return;
      }
      setMsg('✓ Uloženo. Tvá data ovládáš ty.');
    } catch {
      setMsg('Chyba sítě.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Načítám…</p>;
  if (!p) return <p className="p-6 text-sm text-rose-700">{msg ?? 'Profil nedostupný.'}</p>;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4">
      <div>
        <Link href="../" className="text-sm text-primary hover:underline">← Zpět na profil</Link>
        <h1 className="mt-1 text-2xl font-bold">Moje data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tvůj přenosný profil napříč pořadateli. <strong>Vlastníš ho ty</strong> — sám určíš, co sdílíš.
        </p>
      </div>

      {msg ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</div> : null}

      <section className="space-y-2 rounded-lg border p-4">
        <label className="block text-sm font-medium">Zobrazované jméno</label>
        <input
          value={p.displayName ?? ''}
          onChange={(e) => setP({ ...p, displayName: e.target.value })}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Jak tě mají oslovovat"
        />
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <label className="block text-sm font-medium">Oblíbené žánry</label>
        <input
          value={genresText}
          onChange={(e) => setGenresText(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="rock, divadlo, jazz, …"
        />
        <p className="text-xs text-muted-foreground">Oddělené čárkou. Pomáhá s doporučováním akcí.</p>
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <div className="text-sm font-medium">Přístupnost — mé potřeby</div>
        {ACC_OPTIONS.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.accessibilityPrefs[o.key] ?? false}
              onChange={(e) => toggle('accessibilityPrefs', o.key, e.target.checked)}
            />
            {o.label}
          </label>
        ))}
        <p className="text-xs text-muted-foreground">Přednastaví se ti u nákupu, ať to nemusíš řešit pokaždé.</p>
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <div className="text-sm font-medium">Souhlasy s marketingem</div>
        {CONSENT_OPTIONS.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.marketingConsent[o.key] ?? false}
              onChange={(e) => toggle('marketingConsent', o.key, e.target.checked)}
            />
            {o.label}
          </label>
        ))}
      </section>

      <section className="rounded-lg border p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.portable}
            onChange={(e) => setP({ ...p, portable: e.target.checked })}
          />
          <span>
            <strong>Přenositelnost</strong> — povolit používání profilu napříč pořadateli na Tixly
          </span>
        </label>
      </section>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {saving ? 'Ukládám…' : 'Uložit moje data'}
      </button>
    </div>
  );
}
