'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  buyerEmail: string;
  ticketIds: string[];
  originalPriceHalire: number;
}

export function ResaleButton({
  buyerEmail,
  ticketIds,
  originalPriceHalire,
}: Props) {
  const [open, setOpen] = useState(false);
  const [askPriceCzk, setAskPriceCzk] = useState(
    String((originalPriceHalire / 100).toFixed(0)),
  );
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);
  const [activePrice, setActivePrice] = useState<number | null>(null);

  // Demo: pracujeme jen s prvním lístkem. Když pole prázdné, ticketId
  // je undefined a useEffect nemá co fetchnout.
  const ticketId = ticketIds[0];
  const maxCzk = Math.floor(originalPriceHalire / 100);

  useEffect(() => {
    if (!ticketId) return;
    fetch(`/api/buyer/resale/list?ticketId=${ticketId}`)
      .then((r) => r.json())
      .then((d: { active: { listingId: string; askPriceHalire: number } | null }) => {
        if (d.active) {
          setListingId(d.active.listingId);
          setActivePrice(d.active.askPriceHalire);
        }
      })
      .catch(() => {});
  }, [ticketId]);

  if (!ticketId) return null;

  async function handleSubmit() {
    setLoading(true);
    setFeedback(null);
    try {
      const askPriceHalire = Math.round(parseFloat(askPriceCzk) * 100);
      const r = await fetch('/api/buyer/resale/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, askPriceHalire, ownerEmail: buyerEmail }),
      });
      const data = await r.json();
      if (!r.ok) {
        setFeedback(data.message ?? data.error ?? `HTTP ${r.status}`);
        return;
      }
      setListingId(data.listingId);
      setFeedback(
        `Lístek vystaven na resale za ${(askPriceHalire / 100).toLocaleString('cs-CZ')} Kč.`,
      );
    } catch {
      setFeedback('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!listingId) return;
    if (typeof window !== 'undefined' && !window.confirm('Zrušit listing?')) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/buyer/resale/list/${listingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerEmail: buyerEmail }),
      });
      if (!r.ok) {
        const err = await r.json();
        setFeedback(`Zrušení selhalo: ${err.error}`);
        return;
      }
      setListingId(null);
      setActivePrice(null);
      setFeedback('Listing byl stažen z marketplace.');
    } catch {
      setFeedback('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  if (listingId) {
    return (
      <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
        {feedback ? <p className="text-emerald-900">{feedback}</p> : null}
        <p className="text-emerald-900">
          Lístek je v resale marketplace
          {activePrice !== null
            ? ` za ${(activePrice / 100).toLocaleString('cs-CZ')} Kč`
            : ''}.
        </p>
        <div className="flex gap-3">
          <Link
            href={`/cs/resale`}
            className="text-xs text-emerald-700 hover:underline"
          >
            Zobrazit v marketplace →
          </Link>
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className="text-xs font-medium text-rose-700 hover:underline"
          >
            {loading ? 'Ruším…' : 'Zrušit listing'}
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Prodat lístek na resale
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <p className="text-sm font-medium">Cena (max {maxCzk} Kč — face value cap)</p>
      <Input
        type="number"
        min={1}
        max={maxCzk}
        value={askPriceCzk}
        onChange={(e) => setAskPriceCzk(e.target.value)}
      />
      {feedback ? <p className="text-xs text-rose-600">{feedback}</p> : null}
      <div className="flex gap-2">
        <Button onClick={handleSubmit} disabled={loading} size="sm">
          {loading ? 'Vystavuji…' : 'Vystavit'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Zrušit
        </Button>
      </div>
    </div>
  );
}
