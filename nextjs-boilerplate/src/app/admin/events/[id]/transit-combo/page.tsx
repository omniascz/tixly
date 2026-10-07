'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Partner {
  slug: string;
  name: string;
  city: string | null;
  availableZones: string[];
}

interface Combo {
  partnerSlug: string;
  partnerName: string;
  zones: string[];
  validFromOffsetHours: number;
  validUntilOffsetHours: number;
  partnerFeeHalire: number;
  enabled: boolean;
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

export default function TransitComboPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [partners, setPartners] = useState<Partner[]>([]);
  const [combo, setCombo] = useState<Combo | null>(null);
  const [partnerSlug, setPartnerSlug] = useState('');
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/transit-combo`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { combo: Combo | null; partners: Partner[] };
      setPartners(data.partners);
      setCombo(data.combo);
      if (data.combo) {
        setPartnerSlug(data.combo.partnerSlug);
        setSelectedZones(data.combo.zones);
        setEnabled(data.combo.enabled);
      } else if (data.partners.length > 0) {
        setPartnerSlug(data.partners[0].slug);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, [eventId]);

  const currentPartner = partners.find((p) => p.slug === partnerSlug);

  function toggleZone(zone: string): void {
    setSelectedZones((s) =>
      s.includes(zone) ? s.filter((z) => z !== zone) : [...s, zone],
    );
  }

  async function save(): Promise<void> {
    if (!partnerSlug || selectedZones.length === 0) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/transit-combo`, {
        method: 'PATCH',
        body: JSON.stringify({
          partnerSlug,
          zones: selectedZones,
          enabled,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Uloženo. Po koupi vstupenky dostane buyer i MHD jízdenku.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="MHD Kombi-Ticket"
        description="Vstupenka je zároveň jízdenkou DPP/IDOS na den akce. Massive konkurenční výhoda — žádná česká platforma to nemá."
      />

      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>🚇 Demo režim:</strong> DPP API klíč není nastavený. Mock SDK
        generuje validatable QR s HMAC signature. Pro produkci je třeba uzavřít
        partnership s DPP/IDOS (měsíce business lead time).
      </div>

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
          <CardTitle>Aktuální nastavení</CardTitle>
        </CardHeader>
        <CardContent>
          {combo ? (
            <div className="space-y-1 text-sm">
              <p>
                Partner: <strong>{combo.partnerName}</strong>
              </p>
              <p>
                Zóny: <strong>{combo.zones.join(', ')}</strong>
              </p>
              <p>
                Validita: <strong>od půlnoci v den akce do {combo.validUntilOffsetHours - 24}:00 následujícího dne</strong>
              </p>
              <p>
                Status:{' '}
                <span
                  className={`rounded px-2 py-0.5 text-xs ${combo.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}
                >
                  {combo.enabled ? 'Aktivní' : 'Vypnuté'}
                </span>
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Zatím nenastaveno. Vyber partnera + zóny níže.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nastavit transit combo</CardTitle>
          <CardDescription>
            Vyber dopravce a zóny, které budou pokryté MHD jízdenkou. Buyer ji
            stáhne z my-tickets sekce po zaplacení.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
              Dopravce
            </label>
            <select
              value={partnerSlug}
              onChange={(e) => {
                setPartnerSlug(e.target.value);
                setSelectedZones([]);
              }}
              className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm"
              data-testid="transit-partner-select"
            >
              {partners.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} {p.city ? `(${p.city})` : ''}
                </option>
              ))}
            </select>
          </div>

          {currentPartner ? (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                Zóny ({selectedZones.length} vybráno)
              </label>
              <div className="flex flex-wrap gap-2">
                {currentPartner.availableZones.map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => toggleZone(z)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      selectedZones.includes(z)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:bg-muted/40'
                    }`}
                    data-testid={`transit-zone-${z}`}
                  >
                    {z}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Aktivní (buyeři dostávají MHD jízdenku)
          </label>

          <Button
            onClick={() => void save()}
            disabled={busy || !partnerSlug || selectedZones.length === 0}
            data-testid="transit-save"
          >
            {busy ? 'Ukládám…' : 'Uložit'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
