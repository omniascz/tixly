'use client';

import type { Zone } from '../../types/seat-map';

interface SeatMapLegendProps {
  zones: Zone[];
}

const STATUS_LEGEND = [
  { label: 'Volné', color: '#22c55e', description: 'Sedadlo je dostupné' },
  { label: 'Vybráno', color: '#3b82f6', description: 'Vaše dočasná rezervace' },
  { label: 'Blokováno', color: '#94a3b8', description: 'Rezervováno jiným zákazníkem' },
  { label: 'Prodáno', color: '#64748b', description: 'Vstupenka již prodána' },
  { label: 'Nedostupné', color: '#334155', description: 'Místo je blokováno' },
] as const;

export function SeatMapLegend({ zones }: SeatMapLegendProps) {
  return (
    <aside className="flex flex-col gap-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* Zone prices */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Zóny a ceny
        </h3>
        <ul className="space-y-2">
          {zones.map((zone) => (
            <li key={zone.id} className="flex items-center gap-3">
              <span
                className="h-4 w-4 flex-shrink-0 rounded"
                style={{ backgroundColor: zone.color }}
                aria-hidden="true"
              />
              <span className="flex-1 text-sm text-slate-700">{zone.name}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900">
                {zone.price.toLocaleString('cs-CZ')} Kč
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Status legend */}
      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Stav míst
        </h3>
        <ul className="space-y-2">
          {STATUS_LEGEND.map(({ label, color, description }) => (
            <li key={label} className="flex items-center gap-3" title={description}>
              <span
                className="h-4 w-4 flex-shrink-0 rounded"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span className="text-sm text-slate-600">{label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Instructions */}
      <div className="rounded-lg bg-slate-50 p-3">
        <p className="text-xs text-slate-500">
          Kliknutím na volné místo ho dočasně rezervujete.
          Rezervace platí <strong>7 minut</strong>.
          Skrolováním nebo gesty přibližte mapu.
        </p>
      </div>
    </aside>
  );
}
