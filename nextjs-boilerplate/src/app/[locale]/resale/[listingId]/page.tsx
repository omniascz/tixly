'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Listing {
  listingId: string;
  ticketId: string;
  askPriceHalire: number;
  originalPriceHalire: number;
  event: { title: string; dateStart: string; venueName: string | null };
  ticketTypeName: string;
}

function fmtCzk(halire: number) {
  return `${(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

export default function ResaleListingPage() {
  const params = useParams();
  const router = useRouter();
  const listingId = String(params.listingId ?? '');

  const [listing, setListing] = useState<Listing | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/resale/marketplace')
      .then((r) => r.json())
      .then((d: { listings: Listing[] }) => {
        const found = d.listings.find((x) => x.listingId === listingId);
        setListing(found ?? null);
      });
  }, [listingId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/buyer/resale/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, buyerEmail: email, buyerName: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/cs/order-confirmation/${data.newOrderId}`);
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  if (!listing) {
    return (
      <div className="mx-auto max-w-md text-sm text-muted-foreground">
        Načítám listing nebo neexistuje…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>{listing.event.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p>
              <strong>Termín:</strong>{' '}
              {new Date(listing.event.dateStart).toLocaleString('cs-CZ', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
            <p>
              <strong>Místo:</strong> {listing.event.venueName ?? '—'}
            </p>
            <p>
              <strong>Typ:</strong> {listing.ticketTypeName}
            </p>
            <p className="mt-2">
              <strong>Cena:</strong> {fmtCzk(listing.askPriceHalire)}{' '}
              <span className="text-xs text-muted-foreground">
                (face: {fmtCzk(listing.originalPriceHalire)})
              </span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">
                Jméno a příjmení
              </label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">E-mail</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Kupuji…' : `Koupit za ${fmtCzk(listing.askPriceHalire)}`}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
