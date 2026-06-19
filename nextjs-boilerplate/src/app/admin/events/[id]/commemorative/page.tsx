'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Template {
  event_id: string;
  quote: string | null;
  theme_color: string;
  accent_color: string;
  custom_message: string | null;
  is_active: boolean;
  updated_at: string;
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

export default function CommemorativePage(): JSX.Element {
  const params = useParams();
  const eventId = String(params.id);

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [quote, setQuote] = useState('');
  const [themeColor, setThemeColor] = useState('#1a1a2e');
  const [accentColor, setAccentColor] = useState('#e2b96f');
  const [customMessage, setCustomMessage] = useState('');
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      setLoading(true);
      try {
        const res = await authFetch(`/api/admin/events/${eventId}/commemorative`);
        if (res.ok) {
          const j = (await res.json()) as { template: Template | null };
          if (j.template) {
            setTemplate(j.template);
            setQuote(j.template.quote ?? '');
            setThemeColor(j.template.theme_color);
            setAccentColor(j.template.accent_color);
            setCustomMessage(j.template.custom_message ?? '');
            setIsActive(j.template.is_active);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }, [eventId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/commemorative`, {
        method: 'POST',
        body: JSON.stringify({
          quote: quote || null,
          themeColor,
          accentColor,
          customMessage: customMessage || null,
          isActive,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { template?: Template; error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setTemplate(j.template ?? null);
      setFeedback('Vzpomínkový template uložen.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendNow() {
    if (!confirm('Odeslat vzpomínky všem dosud nenotifikovaným scannovaným divákům?')) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch('/api/admin/commemorative/send', {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      });
      const j = (await res.json().catch(() => ({}))) as { sent?: number; error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      const sent = j.sent ?? 0;
      setFeedback(
        sent === 0
          ? (j.message ?? 'Žádné nové vstupenky k odeslání.')
          : `Odesláno ${sent} divák${sent === 1 ? 'ovi' : 'ům'}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vzpomínková vstupenka"
        description="Digitální upomínka poslaná divákům po představení."
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

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Vzpomínky se odesílají automaticky druhý den po představení všem scannovaným divákům. Ručním odesláním pošlete okamžitě všem, kteří ještě vzpomínku nedostali.
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Nastavení</CardTitle>
                {template ? (
                  <Badge variant={isActive ? 'default' : 'secondary'}>
                    {isActive ? 'Aktivní' : 'Neaktivní'}
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                    Citát z inscenace
                  </label>
                  <textarea
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    rows={3}
                    maxLength={500}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Být či nebýt, to je, oč tu běží."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                      Barva pozadí
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={themeColor}
                        onChange={(e) => setThemeColor(e.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border p-0.5"
                      />
                      <span className="text-xs text-muted-foreground">{themeColor} · Tmavá</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                      Barva akcentu
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border p-0.5"
                      />
                      <span className="text-xs text-muted-foreground">{accentColor} · Zlatá</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                    Vlastní zpráva (volitelné)
                  </label>
                  <textarea
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Děkujeme, že jste byli součástí tohoto večera."
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border"
                  />
                  <label htmlFor="isActive" className="text-sm">
                    Aktivovat pro toto představení
                  </label>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="submit" disabled={busy}>
                    {busy ? 'Ukládám…' : 'Uložit'}
                  </Button>
                  {template ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => { void handleSendNow(); }}
                    >
                      Odeslat vzpomínky nyní
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Náhled</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="rounded-xl overflow-hidden"
                style={{ backgroundColor: themeColor, border: `1px solid ${accentColor}33` }}
              >
                <div className="h-1" style={{ backgroundColor: accentColor }} />
                <div className="p-6 space-y-4">
                  <div>
                    <p
                      className="text-xs tracking-widest uppercase mb-1"
                      style={{ color: accentColor }}
                    >
                      Vzpomínka na večer
                    </p>
                    <p className="text-white font-serif text-xl font-bold leading-tight">
                      Název inscenace
                    </p>
                    <p className="text-white/60 text-xs mt-1">
                      15. října 2026 · Národní divadlo
                    </p>
                    <p className="text-white/40 text-xs">Místo: A12</p>
                  </div>
                  {quote ? (
                    <div className="border-l-2 pl-3" style={{ borderColor: accentColor }}>
                      <p className="italic text-sm" style={{ color: accentColor }}>
                        &ldquo;{quote}&rdquo;
                      </p>
                    </div>
                  ) : null}
                  {customMessage ? (
                    <p className="text-white/70 text-xs">{customMessage}</p>
                  ) : null}
                  <div
                    className="pt-3"
                    style={{ borderTop: `1px solid ${accentColor}22` }}
                  >
                    <p className="text-white/40 text-xs">Národní divadlo · 15. 10. 2026</p>
                    <p className="text-xs font-medium tracking-widest mt-0.5" style={{ color: `${accentColor}88` }}>
                      TIXLY
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
