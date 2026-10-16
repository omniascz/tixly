'use client';

import { useEffect, useMemo, useState } from 'react';

interface SeatData {
  id: string;
  sector: string;
  row: string;
  num: string;
  status: 'available' | 'held' | 'sold' | 'blocked';
  acc: boolean;
  ttId: string;
  /** Kolo 8 / krok 3: název a id pojmenované blokace (pokladna vidí, z blokace smí prodat). */
  blockName: string | null;
  blockId: string | null;
}

interface PosSeatRow {
  id: string; sector: string; row: string; seatNumber: string; status: SeatData['status']; ticketTypeId: string;
  seatType: string; blockName: string | null; blockId: string | null;
}

interface Props {
  eventId: string;
  ticketTypeId: string;
  selected: string[];
  /** blockId = výběr z jedné pojmenované blokace (prodej z blokace), jinak null. */
  onChange: (seatIds: string[], blockId: string | null) => void;
  max?: number;
}

export function PosSeatGrid({ eventId, ticketTypeId, selected, onChange, max = 20 }: Props) {
  const [seats, setSeats] = useState<SeatData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    // Kolo 8: pokladní endpoint (s názvem blokace) místo veřejného seznamu sedadel.
    fetch(`/api/admin/pos/events/${eventId}/seats`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { seats: PosSeatRow[] }) => setSeats((d.seats ?? []).map((x) => ({
        id: x.id, sector: x.sector, row: x.row, num: x.seatNumber, status: x.status, acc: x.seatType === 'wheelchair',
        ttId: x.ticketTypeId, blockName: x.blockName, blockId: x.blockId,
      }))))
      .catch(() => setError('Nelze načíst sedadla.'))
      .finally(() => setLoading(false));
  }, [eventId]);

  const filtered = useMemo(
    () => seats.filter((s) => s.ttId === ticketTypeId),
    [seats, ticketTypeId],
  );

  // sector → row → seats[]
  const grouped = useMemo(() => {
    const map = new Map<string, Map<string, SeatData[]>>();
    for (const s of filtered) {
      if (!map.has(s.sector)) map.set(s.sector, new Map());
      const rows = map.get(s.sector)!;
      if (!rows.has(s.row)) rows.set(s.row, []);
      rows.get(s.row)!.push(s);
    }
    for (const [, rows] of map) {
      for (const [, list] of rows) {
        list.sort((a, b) => {
          const na = parseInt(a.num, 10);
          const nb = parseInt(b.num, 10);
          return isNaN(na) || isNaN(nb) ? a.num.localeCompare(b.num) : na - nb;
        });
      }
    }
    return map;
  }, [filtered]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggle(seat: SeatData) {
    const blockSeat = seat.status === 'blocked' && !!seat.blockId;
    if (seat.status !== 'available' && !blockSeat) return;
    // Výběr je buď z volných míst, nebo z jedné blokace (prodej z blokace) — nemíchat.
    const current = filtered.filter((x) => selectedSet.has(x.id));
    const currentBlock = current[0]?.blockId ?? null;
    let next = new Set(selectedSet);
    if (next.has(seat.id)) {
      next.delete(seat.id);
    } else {
      if ((seat.blockId ?? null) !== currentBlock) next = new Set();
      if (next.size >= max) return;
      next.add(seat.id);
    }
    const ids = Array.from(next);
    onChange(ids, ids.length > 0 && blockSeat ? seat.blockId : ids.length > 0 ? currentBlock : null);
  }

  if (loading) return <p className="py-3 text-sm text-muted-foreground">Načítám sedadla…</p>;
  if (error) return <p className="py-3 text-sm text-rose-600">{error}</p>;
  if (filtered.length === 0)
    return <p className="py-3 text-sm text-muted-foreground">Žádná sedadla v tomto tarifu.</p>;

  const selectedLabels = selected
    .map((id) => {
      const s = filtered.find((seat) => seat.id === id);
      return s ? `${s.sector} ${s.row}${s.num}` : null;
    })
    .filter(Boolean) as string[];

  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-auto rounded-md border">
        {Array.from(grouped.entries()).map(([sector, rows]) => (
          <div key={sector}>
            <div className="sticky top-0 z-10 border-b bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {sector}
            </div>
            {Array.from(rows.entries()).map(([rowLabel, seatList]) => (
              <div
                key={rowLabel}
                className="flex items-center gap-1.5 border-b px-3 py-1.5 last:border-b-0"
              >
                <span className="w-5 shrink-0 text-center font-mono text-[11px] font-bold text-muted-foreground">
                  {rowLabel}
                </span>
                <div className="flex flex-wrap gap-1">
                  {seatList.map((seat) => {
                    const isSelected = selectedSet.has(seat.id);
                    const inBlock = seat.status === 'blocked' && !!seat.blockId;
                    const isUnavailable =
                      seat.status === 'sold' ||
                      seat.status === 'held' ||
                      (seat.status === 'blocked' && !inBlock);
                    return (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={isUnavailable}
                        onClick={() => toggle(seat)}
                        title={`${sector} ${rowLabel}${seat.num}${seat.acc ? ' ♿' : ''}${seat.blockName ? ` · blokace: ${seat.blockName}` : ''}`}
                        data-block={seat.blockName ?? undefined}
                        className={[
                          'h-7 w-7 rounded text-[10px] font-semibold transition-colors',
                          isSelected
                            ? 'bg-emerald-500 text-white ring-2 ring-emerald-600'
                            : isUnavailable
                              ? 'cursor-not-allowed bg-gray-100 text-gray-300'
                              : inBlock
                                ? 'border border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200'
                              : 'border border-gray-300 bg-white text-gray-700 hover:border-emerald-400 hover:bg-emerald-50',
                          seat.acc && !isSelected && !isUnavailable
                            ? 'ring-1 ring-emerald-400'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {seat.num}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {selectedLabels.length > 0 ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <span className="font-semibold">Vybráno ({selectedLabels.length}):</span>{' '}
          {selectedLabels.join(', ')}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Klikni na sedadlo pro výběr. Šedá = obsazeno, oranžová = blokace (prodej z blokace, název v nápovědě).
        </p>
      )}
    </div>
  );
}
