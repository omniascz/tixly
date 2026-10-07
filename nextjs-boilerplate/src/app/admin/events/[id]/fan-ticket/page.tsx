'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Settings {
  fan_ticket_enabled: boolean;
  fan_artwork_url: string | null;
}

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

export default function FanTicketPage(): JSX.Element {
  const params = useParams();
  const eventId = String(params.id);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void load(); }, [eventId]);

  async function load() {
    setLoading(true);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/fan-ticket`);
      if (res.ok) setSettings(await res.json() as Settings);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  async function toggleEnabled() {
    if (!settings) return;
    setBusy(true);
    setFeedback(null);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/fan-ticket`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fan_ticket_enabled: !settings.fan_ticket_enabled }),
      });
      if (res.ok) {
        const updated = await res.json() as Settings;
        setSettings(updated);
        setFeedback(updated.fan_ticket_enabled ? 'Fan Ticket aktivován.' : 'Fan Ticket deaktivován.');
      } else {
        setError(`HTTP ${res.status}`);
      }
    } finally { setBusy(false); }
  }

  async function uploadArtwork(file: File) {
    setBusy(true);
    setFeedback(null);
    setError(null);
    try {
      const form = new FormData();
      form.append('artwork', file);
      const res = await authFetch(`/api/admin/events/${eventId}/fan-ticket/artwork`, {
        method: 'POST',
        body: form,
      });
      const j = await res.json() as { url?: string; error?: string };
      if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
      setSettings((prev) => prev ? { ...prev, fan_artwork_url: j.url ?? null } : prev);
      setFeedback('Artwork nahrán a uložen.');
    } finally { setBusy(false); }
  }

  async function removeArtwork() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/fan-ticket`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fan_artwork_url: null }),
      });
      if (res.ok) {
        setSettings((prev) => prev ? { ...prev, fan_artwork_url: null } : prev);
        setFeedback('Artwork odstraněn.');
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fan Ticket"
        description="Prémiová sběratelská digitální vstupenka s artwork akce — analogie k Eventim FanTicket."
      />

      {error   ? <div className="rounded-md border border-rose-300    bg-rose-50    p-3 text-sm text-rose-900">{error}</div>    : null}
      {feedback ? <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div> : null}

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <strong>Jak to funguje:</strong> Nahrajte artwork (plakát / fotka umělce) a zapněte Fan Ticket.
        Kupující automaticky dostanou prémiové PDF — vlevo artwork, vpravo tmavý panel se jménem akce, datem a QR kódem.
        Vstupenka vypadá jako sběratelský objekt, ne jako účtenka. Zdarma, bez příplatku.
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Settings panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Nastavení</CardTitle>
                  <Badge variant={settings?.fan_ticket_enabled ? 'default' : 'secondary'}>
                    {settings?.fan_ticket_enabled ? 'Aktivní' : 'Neaktivní'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={() => { void toggleEnabled(); }}
                  disabled={busy || !settings?.fan_artwork_url}
                  variant={settings?.fan_ticket_enabled ? 'outline' : 'default'}
                  className="w-full"
                >
                  {settings?.fan_ticket_enabled ? 'Deaktivovat Fan Ticket' : 'Aktivovat Fan Ticket'}
                </Button>
                {!settings?.fan_artwork_url && (
                  <p className="text-xs text-muted-foreground">
                    Nejprve nahrajte artwork. Fan Ticket bez artwork nelze aktivovat.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Artwork</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {settings?.fan_artwork_url ? (
                  <div className="space-y-3">
                    <div className="relative overflow-hidden rounded-lg border">
                      <img
                        src={settings.fan_artwork_url}
                        alt="Fan Ticket artwork"
                        className="w-full object-cover"
                        style={{ maxHeight: 200 }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileRef.current?.click()}
                        disabled={busy}
                      >
                        Změnit artwork
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { void removeArtwork(); }}
                        disabled={busy}
                        className="text-rose-600 hover:text-rose-700"
                      >
                        Odstranit
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 cursor-pointer hover:border-primary transition-colors"
                    onClick={() => fileRef.current?.click()}
                  >
                    <div className="text-3xl">🖼️</div>
                    <div className="text-center">
                      <p className="text-sm font-medium">Nahrát artwork</p>
                      <p className="text-xs text-muted-foreground mt-1">PNG, JPG nebo WEBP · max 8 MB</p>
                      <p className="text-xs text-muted-foreground">Doporučeno: portrait nebo čtvercový formát</p>
                    </div>
                    <Button variant="outline" size="sm" type="button" disabled={busy}>
                      Vybrat soubor
                    </Button>
                  </div>
                )}

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadArtwork(f);
                    e.target.value = '';
                  }}
                />
              </CardContent>
            </Card>
          </div>

          {/* Preview */}
          <Card>
            <CardHeader><CardTitle>Náhled Fan Ticket</CardTitle></CardHeader>
            <CardContent>
              <div className="rounded-lg overflow-hidden border" style={{ aspectRatio: '842/595' }}>
                <div className="w-full h-full flex" style={{ fontFamily: 'sans-serif' }}>
                  {/* Artwork panel */}
                  <div
                    className="relative flex-shrink-0"
                    style={{ width: '60%', backgroundColor: '#1a1a2e', overflow: 'hidden' }}
                  >
                    {settings?.fan_artwork_url ? (
                      <img
                        src={settings.fan_artwork_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-white/20 text-4xl">🎭</span>
                      </div>
                    )}
                    {/* Fade edge */}
                    <div
                      className="absolute inset-y-0 right-0 w-8"
                      style={{ background: 'linear-gradient(to right, transparent, #0a0a0a)' }}
                    />
                    {/* Bottom holder */}
                    <div
                      className="absolute bottom-0 left-0 right-0 p-2"
                      style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}
                    >
                      <p className="text-white/70 text-xs">Jan Novák</p>
                      <p className="text-white/40 text-xs">Fan Ticket · Tixly</p>
                    </div>
                  </div>

                  {/* Info panel */}
                  <div className="flex-1 flex flex-col p-3" style={{ backgroundColor: '#0a0a0a' }}>
                    <p className="text-xs mb-1" style={{ color: '#c9a84c', letterSpacing: 1 }}>PROMOTÉR</p>
                    <div className="h-px mb-2 opacity-30" style={{ backgroundColor: '#c9a84c' }} />
                    <p className="text-white font-bold text-sm leading-tight mb-1">Název akce</p>
                    <p className="text-xs mb-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>pá 15. října 2026</p>
                    <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Národní divadlo</p>
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-0.5 h-6 rounded" style={{ backgroundColor: '#c9a84c' }} />
                      <div>
                        <p className="text-white text-xs font-bold">Standardní vstupenka</p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>A12</p>
                      </div>
                    </div>
                    {/* QR placeholder */}
                    <div className="flex-1 flex items-center justify-center">
                      <div className="bg-white rounded p-1.5" style={{ width: 60, height: 60 }}>
                        <div className="w-full h-full grid grid-cols-3 gap-0.5 opacity-50">
                          {Array.from({ length: 9 }).map((_, i) => (
                            <div key={i} className="bg-black rounded-sm" />
                          ))}
                        </div>
                      </div>
                    </div>
                    <p className="text-center text-xs mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>
                      TICKET-ID · Tixly
                    </p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-muted-foreground mt-3 text-center">
                Reálné PDF je A4 landscape (842×595 pt) s plnobarevným tiskem.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Share card info */}
      {settings?.fan_ticket_enabled && (
        <Card>
          <CardHeader><CardTitle>Social Share karta</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Každý kupující má k dispozici share kartu (1080×1080 PNG) ideální pro Instagram a TikTok.
              Karta se vygeneruje automaticky na{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">/api/tickets/[ticketId]/share-card</code>.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Na kartě: artwork jako pozadí + název akce + datum + &ldquo;Byl/a jsem tam&rdquo;.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
