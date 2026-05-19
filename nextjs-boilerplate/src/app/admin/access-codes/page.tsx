'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Trash2, Copy, Check } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
  ticketTypes: { id: string; name: string; basePrice: number; isSeated: boolean }[];
}

interface AccessCode {
  id: string;
  eventId: string;
  eventTitle: string;
  code: string;
  label: string | null;
  maxUses: number | null;
  usesCount: number;
  validFrom: string | null;
  validUntil: string | null;
  ticketTypeIds: string[];
  ticketTypeNames: string[];
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

export default function AccessCodesPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Form state
  const [eventId, setEventId] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState<string>('');
  const [validUntil, setValidUntil] = useState('');
  const [ticketTypeIds, setTicketTypeIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadEvents();
    void loadCodes();
  }, []);

  async function loadEvents() {
    try {
      const res = await authFetch('/api/admin/pos/events');
      if (!res.ok) return;
      const data = (await res.json()) as { events: EventOption[] };
      setEvents(data.events ?? []);
    } catch {
      // ignore
    }
  }

  async function loadCodes() {
    try {
      const res = await authFetch('/api/admin/access-codes');
      if (!res.ok) return;
      const data = (await res.json()) as { codes: AccessCode[] };
      setCodes(data.codes ?? []);
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/access-codes', {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          code: code.toUpperCase().trim(),
          label: label || undefined,
          maxUses: maxUses ? Number(maxUses) : undefined,
          validUntil: validUntil ? new Date(validUntil).toISOString() : undefined,
          ticketTypeIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Reset form + reload
      setCode('');
      setLabel('');
      setMaxUses('');
      setValidUntil('');
      setTicketTypeIds([]);
      await loadCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Opravdu smazat tento kód? Ticket types se vrátí do veřejné nabídky, pokud nemají jiný aktivní kód.')) return;
    try {
      const res = await authFetch(`/api/admin/access-codes/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `HTTP ${res.status}`);
        return;
      }
      await loadCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(text);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // ignore
    }
  }

  const event = events.find((e) => e.id === eventId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Přístupové kódy"
        description="Předprodejní okna pro členy / VIP / partnery. Skryté ticket types odemkneš zadáním kódu na buyer stránce."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nový kód</CardTitle>
            <CardDescription>
              Vyber akci, sepiš kód a propoj ho s vybranými typy lístků.
              Skryté lístky se buyerovi zobrazí až po zadání kódu.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label htmlFor="ac-event" className="mb-1 block text-xs font-medium">
                  Akce
                </label>
                <select
                  id="ac-event"
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value);
                    setTicketTypeIds([]);
                  }}
                  required
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— vyber akci —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ac-code" className="mb-1 block text-xs font-medium">
                    Kód
                  </label>
                  <Input
                    id="ac-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="CLENOVE2026"
                    required
                    className="uppercase"
                    maxLength={40}
                  />
                </div>
                <div>
                  <label htmlFor="ac-label" className="mb-1 block text-xs font-medium">
                    Popis <span className="text-muted-foreground">(intern.)</span>
                  </label>
                  <Input
                    id="ac-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Předprodej pro členy"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ac-maxuses" className="mb-1 block text-xs font-medium">
                    Max použití
                  </label>
                  <Input
                    id="ac-maxuses"
                    type="number"
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value)}
                    placeholder="bez limitu"
                    min={1}
                    max={100000}
                  />
                </div>
                <div>
                  <label htmlFor="ac-until" className="mb-1 block text-xs font-medium">
                    Platnost do
                  </label>
                  <Input
                    id="ac-until"
                    type="datetime-local"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                </div>
              </div>

              {event ? (
                <fieldset className="border-0 p-0">
                  <legend className="mb-1 block text-xs font-medium">
                    Odemkne tyto typy lístků
                  </legend>
                  <div className="space-y-1 rounded-md border p-2">
                    {event.ticketTypes.map((t) => (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          checked={ticketTypeIds.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setTicketTypeIds((prev) => [...prev, t.id]);
                            } else {
                              setTicketTypeIds((prev) => prev.filter((id) => id !== t.id));
                            }
                          }}
                        />
                        <span>
                          {t.name} — {(t.basePrice / 100).toLocaleString('cs-CZ')} Kč
                        </span>
                      </label>
                    ))}
                  </div>
                  {ticketTypeIds.length === 0 ? (
                    <p className="mt-1 text-xs text-amber-700">Vyber alespoň 1 typ lístku.</p>
                  ) : null}
                </fieldset>
              ) : null}

              {error ? (
                <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={busy || !eventId || !code || ticketTypeIds.length === 0}
              >
                {busy ? 'Vytvářím…' : 'Vytvořit kód'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivní kódy ({codes.length})</CardTitle>
            <CardDescription>Klikni na kód pro kopii do schránky.</CardDescription>
          </CardHeader>
          <CardContent>
            {codes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Zatím žádné kódy. Vytvoř první vlevo.
              </p>
            ) : (
              <ul className="space-y-2">
                {codes.map((c) => {
                  const expired = c.validUntil && new Date(c.validUntil) < new Date();
                  const exhausted = c.maxUses !== null && c.usesCount >= c.maxUses;
                  return (
                    <li key={c.id} className="rounded-md border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(c.code)}
                            className="flex items-center gap-1 font-mono text-lg font-semibold hover:text-primary"
                          >
                            {c.code}
                            {copiedCode === c.code ? (
                              <Check className="h-4 w-4 text-emerald-600" aria-hidden />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                            )}
                          </button>
                          {c.label ? (
                            <p className="text-xs text-muted-foreground">{c.label}</p>
                          ) : null}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {c.eventTitle}
                          </p>
                          <p className="mt-1 text-xs">
                            Odemyká:{' '}
                            <span className="text-foreground">
                              {c.ticketTypeNames.join(', ')}
                            </span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Použito: {c.usesCount}
                            {c.maxUses !== null ? ` / ${c.maxUses}` : ' (bez limitu)'}
                            {c.validUntil
                              ? ` · do ${new Date(c.validUntil).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}`
                              : ''}
                          </p>
                          {expired || exhausted ? (
                            <span className="mt-1 inline-block rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-900">
                              {expired ? 'expirovaný' : 'vyčerpaný'}
                            </span>
                          ) : (
                            <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900">
                              aktivní
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id)}
                          className="text-rose-700 hover:bg-rose-50 rounded p-1"
                          aria-label={`Smazat kód ${c.code}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
