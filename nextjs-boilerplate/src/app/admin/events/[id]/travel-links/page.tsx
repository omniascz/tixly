'use client';

/**
 * /admin/events/[id]/travel-links — Cestovní partnerské odkazy
 *
 * Promotér přidá hotely, transport, parkování a rideshare linky.
 * Zobrazí se na potvrzovací stránce objednávky v bloku "Plánujte cestu".
 * 30 % fanoušků cestuje na akce → průměrný extra výdaj $300.
 */

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Trash2, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface TravelLink {
  id: string;
  label: string;
  category: string;
  partner_name: string | null;
  url: string;
  affiliate_note: string | null;
  active: boolean;
  display_order: number;
  created_at: string;
}

const CATEGORY_META: Record<string, { icon: string; label: string }> = {
  hotel:      { icon: '🏨', label: 'Hotel / ubytování' },
  transport:  { icon: '🚆', label: 'Doprava' },
  parking:    { icon: '🅿️', label: 'Parkování' },
  rideshare:  { icon: '🚗', label: 'Sdílená jízda' },
  other:      { icon: '🔗', label: 'Ostatní' },
};

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

export default function TravelLinksPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [links, setLinks] = useState<TravelLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('hotel');
  const [partnerName, setPartnerName] = useState('');
  const [url, setUrl] = useState('');
  const [affiliateNote, setAffiliateNote] = useState('');

  useEffect(() => { void load(); }, [eventId]);

  async function load() {
    const res = await authFetch(`/api/admin/events/${eventId}/travel-links`);
    if (res.ok) {
      const data = (await res.json()) as { links: TravelLink[] };
      setLinks(data.links);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) { setError('Popis odkazu je povinný.'); return; }
    if (!url.trim()) { setError('URL je povinná.'); return; }
    setBusy(true); setError(null); setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/travel-links`, {
        method: 'POST',
        body: JSON.stringify({ label, category, partner_name: partnerName, url, affiliate_note: affiliateNote }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setFeedback('Odkaz přidán.');
      setLabel(''); setPartnerName(''); setUrl(''); setAffiliateNote(''); setCategory('hotel');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(link: TravelLink) {
    await authFetch(`/api/admin/events/${eventId}/travel-links/${link.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !link.active }),
    });
    await load();
  }

  async function deleteLink(id: string) {
    if (!confirm('Smazat odkaz?')) return;
    await authFetch(`/api/admin/events/${eventId}/travel-links/${id}`, { method: 'DELETE' });
    await load();
  }

  const grouped = Object.entries(CATEGORY_META).map(([cat, meta]) => ({
    cat, meta, items: links.filter((l) => l.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cestovní partnerské odkazy"
        description='30 % fanoušků cestuje na akce. Zobrazí se na stránce potvrzení objednávky pod "Plánujte cestu".'
      />

      {/* Info banner */}
      <div className="rounded-xl border bg-amber-50 p-4 text-sm text-amber-900">
        <strong>💡 Tip:</strong> Přidej hotely, parkování a transport pro fanoušky. Průměrný extra výdaj fanouška
        cestujícího na akci je <strong>$300</strong>. Affiliate odkaz na Booking.com, LiftGo nebo CzechParking
        generuje provizi bez nastavení integrace.
      </div>

      {/* Add form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Přidat partnerský odkaz</CardTitle>
          <CardDescription className="text-xs">
            Odkaz se zobrazí kupujícím na potvrzovací stránce po zakoupení lístku.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleAdd(e)} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Kategorie</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                {Object.entries(CATEGORY_META).map(([val, m]) => (
                  <option key={val} value={val}>{m.icon} {m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Název partnera</label>
              <Input
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
                placeholder="Booking.com, CD.cz, CzechParking…"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Popis odkazu *</label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Hotel Marriott Praha — 15% sleva pro hosty akce"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">URL *</label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://booking.com/affiliate?aid=..."
                type="url"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Poznámka (affiliate / podmínky)</label>
              <Input
                value={affiliateNote}
                onChange={(e) => setAffiliateNote(e.target.value)}
                placeholder="Platí do 7 dní před akcí. Affiliate provize 6 %."
                maxLength={200}
              />
            </div>
            {error && <p className="sm:col-span-2 text-xs text-rose-600">{error}</p>}
            {feedback && <p className="sm:col-span-2 text-xs text-emerald-600">{feedback}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy} size="sm">
                {busy ? 'Přidávám…' : 'Přidat odkaz'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Grouped link list */}
      {links.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Žádné partnerské cestovní odkazy. Přidej hotel nebo parking — zobrazí se kupujícím po nákupu.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ cat, meta, items }) => (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {meta.icon} {meta.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((link) => (
                  <div
                    key={link.id}
                    className={`flex items-start gap-3 rounded-md border p-3 ${link.active ? '' : 'opacity-50'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{link.label}</div>
                      {link.partner_name && (
                        <div className="text-xs text-muted-foreground">{link.partner_name}</div>
                      )}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 flex items-center gap-1 text-xs text-primary underline truncate"
                      >
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        {link.url}
                      </a>
                      {link.affiliate_note && (
                        <p className="mt-0.5 text-xs text-muted-foreground italic">{link.affiliate_note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void toggleActive(link)}
                      >
                        {link.active ? 'Skrýt' : 'Aktivovat'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-rose-500 hover:bg-rose-50"
                        onClick={() => void deleteLink(link.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
