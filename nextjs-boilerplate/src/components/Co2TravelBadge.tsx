'use client';

import { useEffect, useState } from 'react';

/**
 * B6 — CO₂ štítek dopravy na stránce akce / v checkoutu.
 * Ukáže úsporu vlakem vs autem + (na klíč) vyhledání vlaku.
 */

interface Co2Data {
  co2: { message: string; savingKg: number; trainKg: number; carSoloKg: number };
  railBundle: { available: boolean; toCity: string | null };
}

export function Co2TravelBadge({ eventId }: { eventId: string }) {
  const [data, setData] = useState<Co2Data | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/public/events/${eventId}/co2`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Co2Data | null) => { if (alive) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [eventId]);

  if (!data) return null;

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
      <div className="flex items-center gap-2 font-semibold">
        <span aria-hidden>🌱</span>
        Přijeď šetrně
      </div>
      <p className="mt-1 text-xs">{data.co2.message}</p>
      <div className="mt-1 text-xs text-emerald-700">
        🚗 auto ~{data.co2.carSoloKg} kg · 🚆 vlak ~{data.co2.trainKg} kg CO₂ (tam a zpět)
      </div>
      {data.railBundle.available ? (
        <button
          type="button"
          className="mt-2 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white"
          onClick={() => {
            const to = data.railBundle.toCity ?? '';
            window.open(`https://www.regiojet.cz/?to=${encodeURIComponent(to)}`, '_blank', 'noopener');
          }}
        >
          🚆 Najít vlak
        </button>
      ) : (
        <p className="mt-1 text-xs text-emerald-700">Přímé propojení s ČD/Regiojet brzy — zatím doraž vlakem a ušetři planetě i peníze.</p>
      )}
    </div>
  );
}
