'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Seller {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string;
  location_type: string;
  opening_hours: string | null;
  website: string | null;
  logo_url: string | null;
  lat: number | null;
  lng: number | null;
}

const TYPE_LABEL: Record<string, string> = {
  partner: 'Autorizovaný partner',
  kiosk: 'Samoobslužný kiosk',
  post_office: 'Pošta',
  cinema: 'Kino',
  convenience: 'Prodejna',
};
const TYPE_ICON: Record<string, string> = {
  partner: '🏪', kiosk: '🖥️', post_office: '✉️', cinema: '🎬', convenience: '🛒',
};

export default function SellersPage() {
  const [sellers, setSellers] = useState<Record<string, Seller[]>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('CZ');
  const [typeFilter, setTypeFilter] = useState('');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ country });
    if (q.trim()) params.set('q', q.trim());
    if (typeFilter) params.set('type', typeFilter);
    fetch(`/api/sellers?${params}`)
      .then((r) => r.json())
      .then((d: { sellers: Seller[]; byCity: Record<string, Seller[]>; total: number }) => {
        setSellers(d.byCity ?? {});
        setTotal(d.total ?? 0);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [country, q, typeFilter]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Prodejní místa</h1>
        <p className="mt-2 text-muted-foreground">
          Vstupenky lze zakoupit osobně na těchto prodejních místech — bez potřeby internetu nebo platební karty.
        </p>
      </div>

      {/* Filtry */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Input
          placeholder="Hledat místo nebo adresu…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="CZ">Česká republika</option>
          <option value="SK">Slovensko</option>
          <option value="AT">Rakousko</option>
          <option value="DE">Německo</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Všechny typy</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        {(q || typeFilter) ? (
          <Button variant="ghost" size="sm" onClick={() => { setQ(''); setTypeFilter(''); }}>
            Zrušit filtry
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Načítám prodejní místa…</p>
      ) : total === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-8 text-center">
          <p className="text-lg font-semibold">Žádné prodejní místo nenalezeno</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Zkuste změnit zemi nebo zrušit filtry. Prodejní síť stále rozrůstáme.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">{total} prodejních míst</p>
          {Object.entries(sellers).map(([city, locs]) => (
            <div key={city} className="mb-8">
              <h2 className="mb-3 text-xl font-bold">{city}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {locs.map((s) => (
                  <div
                    key={s.id}
                    className="flex gap-3 rounded-lg border bg-card p-4 shadow-sm"
                  >
                    {s.logo_url ? (
                      <img src={s.logo_url} alt={s.name} className="h-10 w-10 shrink-0 rounded object-contain" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted text-xl">
                        {TYPE_ICON[s.location_type] ?? '📍'}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.address}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                          {TYPE_LABEL[s.location_type] ?? s.location_type}
                        </span>
                        {s.opening_hours ? (
                          <span className="text-xs text-muted-foreground">🕒 {s.opening_hours}</span>
                        ) : null}
                        {s.website ? (
                          <a
                            href={s.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            Web →
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div className="mt-12 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Chcete se stát prodejním partnerem Tixly?{' '}
        <Link href="/cs/contact" className="text-primary hover:underline">Kontaktujte nás</Link>.
      </div>
    </div>
  );
}
