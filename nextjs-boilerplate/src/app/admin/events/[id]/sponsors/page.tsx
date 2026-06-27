'use client';

/**
 * /admin/events/[id]/sponsors — Sponzorský modul (Ignite-style)
 *
 * Promotér přidá sponzory s logem a odkazem. Zobrazí se na stránce potvrzení
 * objednávky, v ticketovém emailu nebo na event stránce (dle placement).
 */

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  click_url: string | null;
  tagline: string | null;
  placement: string;
  active: boolean;
  display_order: number;
  created_at: string;
}

const PLACEMENT_LABELS: Record<string, string> = {
  all: 'Všechna místa',
  confirmation: 'Stránka potvrzení',
  event_page: 'Event stránka',
  ticket_email: 'Ticketový email',
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

export default function SponsorsPage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [clickUrl, setClickUrl] = useState('');
  const [tagline, setTagline] = useState('');
  const [placement, setPlacement] = useState('all');

  useEffect(() => { void load(); }, [eventId]);

  async function load() {
    const res = await authFetch(`/api/admin/events/${eventId}/sponsors`);
    if (res.ok) {
      const data = (await res.json()) as { sponsors: Sponsor[] };
      setSponsors(data.sponsors);
    }
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Název sponzora je povinný.'); return; }
    setBusy(true); setError(null); setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/sponsors`, {
        method: 'POST',
        body: JSON.stringify({ name, logo_url: logoUrl, click_url: clickUrl, tagline, placement }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setFeedback('Sponzor přidán.');
      setName(''); setLogoUrl(''); setClickUrl(''); setTagline(''); setPlacement('all');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(s: Sponsor) {
    await authFetch(`/api/admin/events/${eventId}/sponsors/${s.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !s.active }),
    });
    await load();
  }

  async function deleteSponsor(id: string) {
    if (!confirm('Smazat sponzora?')) return;
    await authFetch(`/api/admin/events/${eventId}/sponsors/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sponzorský modul"
        description="Sponzoři se zobrazí na stránce potvrzení, v ticketovém emailu nebo na event stránce."
      />

      {/* Stats Banner */}
      <div className="grid grid-cols-3 gap-3 rounded-xl border bg-gradient-to-r from-violet-50 to-blue-50 p-4">
        <div className="text-center">
          <div className="text-2xl font-extrabold text-violet-700">58%</div>
          <div className="text-xs text-muted-foreground">fanoušků kupuje add-ony</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-extrabold text-blue-700">$300</div>
          <div className="text-xs text-muted-foreground">přidaných výdajů/fanouška</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-extrabold text-emerald-700">30%</div>
          <div className="text-xs text-muted-foreground">cestuje na akci</div>
        </div>
      </div>

      {/* Add form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Přidat sponzora</CardTitle>
          <CardDescription className="text-xs">
            Logo sponzora se zobrazí na potvrzovací stránce a ve walletovém lístku.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleAdd(e)} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium">Název sponzora *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Pilsner Urquell, Škoda Auto…"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">URL loga (obrázek)</label>
              <Input
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                placeholder="https://cdn.example.com/logo.png"
                type="url"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Odkaz (click URL)</label>
              <Input
                value={clickUrl}
                onChange={(e) => setClickUrl(e.target.value)}
                placeholder="https://pilsnerurquell.cz"
                type="url"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Tagline / slogan</label>
              <Input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Generální partner akce"
                maxLength={200}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Umístění</label>
              <select
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                {Object.entries(PLACEMENT_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            {error && <p className="sm:col-span-2 text-xs text-rose-600">{error}</p>}
            {feedback && <p className="sm:col-span-2 text-xs text-emerald-600">{feedback}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy} size="sm">
                {busy ? 'Přidávám…' : 'Přidat sponzora'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Sponsor list */}
      {sponsors.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Žádní sponzoři. Přidej prvního sponzora — zobrazí se na potvrzení objednávky.
        </div>
      ) : (
        <div className="space-y-3">
          {sponsors.map((s) => (
            <Card key={s.id} className={s.active ? '' : 'opacity-50'}>
              <CardContent className="flex items-center gap-4 p-4">
                {s.logo_url ? (
                  <img
                    src={s.logo_url}
                    alt={s.name}
                    className="h-10 w-20 object-contain rounded border"
                  />
                ) : (
                  <div className="flex h-10 w-20 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">
                    Bez loga
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  {s.tagline && (
                    <div className="text-xs text-muted-foreground truncate">{s.tagline}</div>
                  )}
                  <div className="mt-1 flex gap-2 text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5">
                      {PLACEMENT_LABELS[s.placement] ?? s.placement}
                    </span>
                    {s.click_url && (
                      <a
                        href={s.click_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline truncate max-w-[160px]"
                      >
                        {s.click_url}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void toggleActive(s)}
                  >
                    {s.active ? 'Skrýt' : 'Aktivovat'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-rose-500 hover:bg-rose-50"
                    onClick={() => void deleteSponsor(s.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
