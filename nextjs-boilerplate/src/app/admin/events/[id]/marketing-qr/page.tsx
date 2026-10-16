'use client';

import { FormEvent, useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Campaign {
  id: string;
  slug: string;
  name: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  scanCount: number;
  conversionCount: number;
  conversionTotalHalire: number;
  conversionRate: number;
  createdAt: string;
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

function fmtCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} Kč`;
}

export default function MarketingQrPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [utmSource, setUtmSource] = useState('print');
  const [busy, setBusy] = useState(false);

  async function load(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/marketing-qr`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  async function downloadPng(campaignId: string, campaignSlug: string): Promise<void> {
    try {
      const res = await authFetch(
        `/api/admin/events/${eventId}/marketing-qr/${campaignId}/png?size=600`,
      );
      if (!res.ok) {
        setError(`Stažení selhalo: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tixly-qr-${campaignSlug}-600.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function createCampaign(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/marketing-qr`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug: slug.trim() || undefined,
          utmSource: utmSource || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setName('');
      setSlug('');
      setFeedback('Kampaň vytvořena. Stáhni si PNG níže.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Print marketing — QR kampaně"
        description="Vytvoř krátký QR pro plakát, leták nebo billboard. Po naskenování buyer skončí na detailu akce a měříme kolik prodejů odtud přišlo."
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
          <CardTitle>Vytvořit novou kampaň</CardTitle>
          <CardDescription>
            Slug se použije v URL: <code>{`/qr/{slug}`}</code>. Pokud ho necháš prázdný,
            vygeneruje se z názvu.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={createCampaign} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="qr-name" className="mb-1 block text-xs font-medium">
                Název kampaně *
              </label>
              <Input
                id="qr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="např. Plakát Praha 1"
                required
                data-testid="qr-campaign-name"
              />
            </div>
            <div>
              <label htmlFor="qr-slug" className="mb-1 block text-xs font-medium">
                Slug <span className="text-muted-foreground">(volitelně)</span>
              </label>
              <Input
                id="qr-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="plakat-praha-1"
                pattern="[a-z0-9-]+"
                data-testid="qr-campaign-slug"
              />
            </div>
            <div>
              <label htmlFor="qr-utm" className="mb-1 block text-xs font-medium">
                UTM source
              </label>
              <Input
                id="qr-utm"
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                placeholder="print | poster | flyer | billboard"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={busy || !name.trim()} data-testid="qr-campaign-create">
                {busy ? 'Vytvářím…' : 'Vytvořit kampaň'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Aktivní kampaně ({campaigns?.length ?? 0})</CardTitle>
          <CardDescription>
            Klikni na <strong>Stáhnout PNG</strong> a vlož do Canva nebo otevři v tiskárně.
            Rozlišení 600 px je dostatek pro A4 plakát.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!campaigns ? (
            <p className="text-sm text-muted-foreground">Načítání…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím žádná kampaň. Vytvoř první nahoře.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="pb-2">Název</th>
                    <th className="pb-2">URL</th>
                    <th className="pb-2 text-right">Skeny</th>
                    <th className="pb-2 text-right">Prodeje</th>
                    <th className="pb-2 text-right">Tržba</th>
                    <th className="pb-2 text-right">CR</th>
                    <th className="pb-2">PNG</th>
                  </tr>
                </thead>
                <tbody data-testid="qr-campaigns-list">
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-t">
                      <td className="py-2">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">
                          UTM: {c.utmSource} / {c.utmMedium}
                        </div>
                      </td>
                      <td className="py-2 font-mono text-xs">/qr/{c.slug}</td>
                      <td className="py-2 text-right tabular-nums">{c.scanCount}</td>
                      <td className="py-2 text-right tabular-nums">{c.conversionCount}</td>
                      <td className="py-2 text-right tabular-nums">
                        {fmtCzk(c.conversionTotalHalire)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {c.conversionRate.toFixed(1)} %
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => void downloadPng(c.id, c.slug)}
                          className="text-xs text-blue-700 hover:underline"
                          data-testid={`qr-download-${c.slug}`}
                        >
                          ⬇ Stáhnout
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
