/**
 * Buyer "Build Your Own Pass" UI — modular festival pass.
 *
 * Kupec si checkboxes vybere (day × zone) kombinace, vidí live price calc,
 * vyplní email + jméno, POST na /api/buyer/modular-pass/checkout.
 *
 * Pokud event nemá modular pass enabled (catalog.ticket_modular_pricing
 * row chybí), zobrazí "Not available" hlášku.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Day = { id: string; day_index: number; label: string | null; starts_at: string };
type Zone = { id: string; name: string; zone_type: string; description: string | null };
type Tt = {
  id: string;
  name: string;
  base_price: number;
  per_day_price_minor: number;
  per_zone_surcharge_minor: number;
  min_days: number;
  max_days: number | null;
  min_zones: number;
  max_zones: number | null;
};

function formatCzk(halire: number): string {
  return `${(halire / 100).toFixed(0)} Kč`;
}

export default function BuildPassPage(): JSX.Element {
  const params = useParams<{ id: string; locale: string }>();
  const eventId = params?.id ?? '';
  const router = useRouter();
  const [ticketType, setTicketType] = useState<Tt | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  const [selectedZones, setSelectedZones] = useState<Set<string>>(new Set());
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    void fetch(`/api/events/${eventId}/modular-pass`)
      .then(async (r) => {
        if (!r.ok) {
          const b = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? `HTTP_${r.status}`);
        }
        return r.json() as Promise<{ ticketType: Tt; days: Day[]; zones: Zone[] }>;
      })
      .then((body) => {
        setTicketType(body.ticketType);
        setDays(body.days);
        setZones(body.zones);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [eventId]);

  const totalAmount = useMemo(() => {
    if (!ticketType) return 0;
    return (
      ticketType.base_price +
      selectedDays.size * ticketType.per_day_price_minor +
      selectedZones.size * ticketType.per_zone_surcharge_minor
    );
  }, [ticketType, selectedDays, selectedZones]);

  const validationError = useMemo(() => {
    if (!ticketType) return null;
    if (selectedDays.size < ticketType.min_days) {
      return `Vyber alespoň ${ticketType.min_days} dní.`;
    }
    if (ticketType.max_days !== null && selectedDays.size > ticketType.max_days) {
      return `Maximálně ${ticketType.max_days} dní.`;
    }
    if (selectedZones.size < ticketType.min_zones) {
      return `Vyber alespoň ${ticketType.min_zones} zón.`;
    }
    if (ticketType.max_zones !== null && selectedZones.size > ticketType.max_zones) {
      return `Maximálně ${ticketType.max_zones} zón.`;
    }
    return null;
  }, [ticketType, selectedDays, selectedZones]);

  function toggleDay(id: string): void {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleZone(id: string): void {
    setSelectedZones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (validationError || !ticketType) return;
    setBusy(true);
    setError(null);

    // Build cartesian product (day × zone) selections
    const selections: Array<{ dayId: string; zoneId: string }> = [];
    for (const dayId of selectedDays) {
      for (const zoneId of selectedZones) {
        selections.push({ dayId, zoneId });
      }
    }

    try {
      const r = await fetch('/api/buyer/modular-pass/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          ticketTypeId: ticketType.id,
          selections,
          buyerEmail: email,
          buyerName: name,
          paymentMethod: 'gopay',
        }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP_${r.status}`);
      }
      const body = (await r.json()) as { gatewayUrl: string };
      router.push(body.gatewayUrl);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (loading) return <main className="p-8"><p className="text-slate-500">Načítám…</p></main>;
  if (error && !ticketType)
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold text-rose-700">
          Modular pass není pro tento event dostupný
        </h1>
        <p className="mt-3 text-slate-600">
          {error === 'NO_MODULAR_PASS'
            ? 'Promotér nezapnul modular pass pro tento event. Použij standardní vstupenku.'
            : `Chyba: ${error}`}
        </p>
      </main>
    );
  if (!ticketType) return <main className="p-8"><p>Žádná data.</p></main>;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-3xl font-semibold">Build your own pass 🎟️</h1>
      <p className="mt-2 text-slate-600">
        Vyber dny a stage, kam chceš jít. Cena se přepočítává živě podle tvého
        výběru.
      </p>

      <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-700">
          <strong>{ticketType.name}</strong> — base {formatCzk(ticketType.base_price)} +{' '}
          {formatCzk(ticketType.per_day_price_minor)}/den +{' '}
          {formatCzk(ticketType.per_zone_surcharge_minor)}/zónu
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Limity: {ticketType.min_days}
          {ticketType.max_days ? `–${ticketType.max_days}` : '+'} dní ×{' '}
          {ticketType.min_zones}
          {ticketType.max_zones ? `–${ticketType.max_zones}` : '+'} zón
        </p>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">📅 Dny</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {days.map((d) => {
            const checked = selectedDays.has(d.id);
            return (
              <label
                key={d.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                  checked
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-300 bg-white'
                }`}
                data-testid={`day-${d.day_index}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDay(d.id)}
                  className="h-4 w-4 accent-emerald-600"
                />
                <div>
                  <div className="font-medium">
                    Den {d.day_index + 1}
                    {d.label ? ` — ${d.label}` : ''}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {new Date(d.starts_at).toLocaleDateString('cs-CZ')}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-lg font-semibold">🎤 Stage / Zóny</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {zones.map((z) => {
            const checked = selectedZones.has(z.id);
            return (
              <label
                key={z.id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${
                  checked
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-300 bg-white'
                }`}
                data-testid={`zone-${z.name}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleZone(z.id)}
                  className="h-4 w-4 accent-emerald-600"
                />
                <div>
                  <div className="font-medium">{z.name}</div>
                  <div className="text-[10px] text-slate-500">{z.zone_type}</div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-violet-200 bg-violet-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-violet-700">
              Cena
            </p>
            <p
              className="text-3xl font-bold text-violet-900"
              data-testid="modular-pass-total"
            >
              {formatCzk(totalAmount)}
            </p>
          </div>
          <div className="text-right text-xs text-violet-700">
            <p>{selectedDays.size} dní × {selectedZones.size} zón</p>
            <p>= {selectedDays.size * selectedZones.size} access tokenů</p>
          </div>
        </div>
      </section>

      <form onSubmit={submit} className="mt-6 space-y-3">
        <label className="block text-sm font-medium">
          Jméno
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm font-medium">
          E-mail
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        {validationError && (
          <p className="text-sm text-rose-600">{validationError}</p>
        )}
        {error && <p className="text-sm text-rose-600">Chyba: {error}</p>}

        <button
          type="submit"
          disabled={busy || !!validationError}
          className="w-full rounded-md bg-violet-600 px-4 py-3 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          data-testid="modular-pass-checkout"
        >
          {busy ? 'Vytvářím objednávku…' : `Koupit za ${formatCzk(totalAmount)}`}
        </button>
      </form>
    </main>
  );
}
