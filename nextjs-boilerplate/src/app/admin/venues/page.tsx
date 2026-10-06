'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/admin/PageHeader';
import { VenueLibrary } from './VenueLibrary';

/**
 * Seznam sálů.
 *
 * Sály v levém menu dosud vůbec nebyly — editor plánku sedadel
 * (/admin/venues/[venueId]/seating-chart/editor) byl hotový, ale dostal se
 * k němu jen ten, kdo znal přesnou URL.
 */

interface Venue {
  id: string;
  name: string;
  city: string | null;
  capacity: number | null;
  venue_type: string | null;
}

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    fetch('/api/admin/venues', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sály se nepodařilo načíst (HTTP ${res.status}).`);
        return (await res.json()) as { venues: Venue[] };
      })
      .then((d) => setVenues(d.venues ?? []))
      .catch((e: Error) => {
        setError(e.message);
        setVenues([]);
      });
  }, []);

  return (
    <div>
      <PageHeader
        title="Sály"
        description="Místa konání, jejich sály, kapacita a plánky sedadel."
      />

      <VenueLibrary />
      <h2 className="mb-3 text-lg font-semibold">Všechny sály</h2>

      {error ? (
        <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          {error}
        </div>
      ) : null}

      {venues === null ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : venues.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center">
          <MapPin className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">Zatím nemáte žádný sál</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sál založíte výše v knihovně míst: přidejte místo (název, město) a v něm sál — rovnou se otevře editor plánku.
          </p>
          <Link
            href="/admin/events/new"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Založit akci
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {venues.map((v) => (
            <div key={v.id} className="rounded-lg border bg-card p-4">
              <div className="font-medium">{v.name}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[v.city, v.capacity ? `kapacita ${v.capacity}` : null]
                  .filter(Boolean)
                  .join(' · ') || 'Bez dalších údajů'}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                <Link
                  href={`/admin/venues/${v.id}/seating-chart/editor`}
                  className="font-medium text-primary hover:underline"
                >
                  {/* Kolo 12: dřív „Plánek sedadel" na stránku jen pro čtení („kontaktuj master admina"), která odporovala editoru */}
                  Editor plánku
                </Link>
                <Link
                  href={`/admin/venues/${v.id}/gates`}
                  className="font-medium text-primary hover:underline"
                >
                  Vstupy a brány
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
