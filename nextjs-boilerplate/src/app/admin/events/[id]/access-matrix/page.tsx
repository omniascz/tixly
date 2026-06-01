/**
 * Admin UI — per-event access matrix editor.
 *
 * Promotér edituje matrix (ticket_type × day × zone) post-creation.
 * Toggle checkbox = INSERT/DELETE row v `catalog.ticket_type_access`.
 * Quick actions: "All days × all zones" (wildcard), clear, copy from other TT.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Tt = { id: string; name: string; base_price: number };
type Day = { id: string; day_index: number; label: string | null; starts_at: string };
type Zone = { id: string; name: string; zone_type: string; capacity: number | null };
type AccessRow = {
  id: string;
  ticket_type_id: string;
  event_day_id: string | null;
  zone_id: string | null;
  access_level: string;
};

type Entry = {
  ticketTypeId: string;
  dayId: string | 'all';
  zoneId: string | 'all';
  level: 'general' | 'premium' | 'vip' | 'backstage' | 'accessibility';
};

export default function AccessMatrixPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const eventId = params?.id ?? '';
  const [tts, setTts] = useState<Tt[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTtId, setActiveTtId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch(`/api/admin/events/${eventId}/access-matrix`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        setMsg(`Chyba načtení: ${r.status}`);
        return;
      }
      const body = (await r.json()) as {
        ticketTypes: Tt[];
        days: Day[];
        zones: Zone[];
        access: AccessRow[];
      };
      setTts(body.ticketTypes);
      setDays(body.days);
      setZones(body.zones);
      setEntries(
        body.access.map((a) => ({
          ticketTypeId: a.ticket_type_id,
          dayId: a.event_day_id ?? 'all',
          zoneId: a.zone_id ?? 'all',
          level: a.access_level as Entry['level'],
        })),
      );
      if (body.ticketTypes.length > 0 && !activeTtId) {
        setActiveTtId(body.ticketTypes[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [eventId, activeTtId]);

  useEffect(() => {
    if (eventId) void load();
  }, [eventId, load]);

  const activeEntries = useMemo(
    () => entries.filter((e) => e.ticketTypeId === activeTtId),
    [entries, activeTtId],
  );

  const hasWildcardAll = activeEntries.some(
    (e) => e.dayId === 'all' && e.zoneId === 'all',
  );

  function hasAccess(dayId: string, zoneId: string): boolean {
    if (!activeTtId) return false;
    return activeEntries.some(
      (e) =>
        (e.dayId === 'all' || e.dayId === dayId) &&
        (e.zoneId === 'all' || e.zoneId === zoneId),
    );
  }

  function toggleCell(dayId: string, zoneId: string): void {
    if (!activeTtId) return;
    const exact = activeEntries.find(
      (e) => e.dayId === dayId && e.zoneId === zoneId,
    );
    if (exact) {
      setEntries((prev) =>
        prev.filter(
          (e) =>
            !(
              e.ticketTypeId === activeTtId &&
              e.dayId === dayId &&
              e.zoneId === zoneId
            ),
        ),
      );
    } else {
      setEntries((prev) => [
        ...prev,
        { ticketTypeId: activeTtId, dayId, zoneId, level: 'general' },
      ]);
    }
  }

  function setWildcardAll(): void {
    if (!activeTtId) return;
    setEntries((prev) => [
      ...prev.filter((e) => e.ticketTypeId !== activeTtId),
      { ticketTypeId: activeTtId, dayId: 'all', zoneId: 'all', level: 'general' },
    ]);
  }

  function clearAll(): void {
    if (!activeTtId) return;
    setEntries((prev) => prev.filter((e) => e.ticketTypeId !== activeTtId));
  }

  function selectWholeDay(dayId: string): void {
    if (!activeTtId) return;
    const allCovered = zones.every((z) => hasAccess(dayId, z.id));
    if (allCovered) {
      // Remove all day-specific entries
      setEntries((prev) =>
        prev.filter(
          (e) =>
            !(
              e.ticketTypeId === activeTtId &&
              (e.dayId === dayId || e.dayId === 'all')
            ),
        ),
      );
    } else {
      // Add entries for all zones × this day
      setEntries((prev) => [
        ...prev.filter(
          (e) =>
            !(
              e.ticketTypeId === activeTtId &&
              (e.dayId === dayId || e.dayId === 'all')
            ),
        ),
        ...zones.map((z) => ({
          ticketTypeId: activeTtId,
          dayId,
          zoneId: z.id,
          level: 'general' as const,
        })),
      ]);
    }
  }

  function selectWholeZone(zoneId: string): void {
    if (!activeTtId) return;
    const allCovered = days.every((d) => hasAccess(d.id, zoneId));
    if (allCovered) {
      setEntries((prev) =>
        prev.filter(
          (e) =>
            !(
              e.ticketTypeId === activeTtId &&
              (e.zoneId === zoneId || e.zoneId === 'all')
            ),
        ),
      );
    } else {
      setEntries((prev) => [
        ...prev.filter(
          (e) =>
            !(
              e.ticketTypeId === activeTtId &&
              (e.zoneId === zoneId || e.zoneId === 'all')
            ),
        ),
        ...days.map((d) => ({
          ticketTypeId: activeTtId,
          dayId: d.id,
          zoneId,
          level: 'general' as const,
        })),
      ]);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setMsg(null);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch(`/api/admin/events/${eventId}/access-matrix`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ entries }),
      });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP_${r.status}`);
      }
      setMsg('Uloženo ✓');
      await load();
    } catch (e) {
      setMsg(`Chyba: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6 text-sm text-slate-500">Načítám…</p>;
  if (tts.length === 0)
    return (
      <p className="p-6 text-sm text-slate-500">
        Tento event nemá žádné ticket types. Vytvoř je nejdřív v event editoru.
      </p>
    );
  if (days.length === 0 && zones.length === 0)
    return (
      <p className="p-6 text-sm text-amber-700">
        Tento event nemá žádné dny ani zóny. Access matrix je pro multi-day /
        multi-zone akce (festival, konference). Single-stage event funguje
        wildcard (žádné access rows = full access).
      </p>
    );

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Access matrix</h1>
      <p className="text-sm text-slate-600">
        Vyber typ vstupenky a zaškrtni kombinace dnů a zón, kam má přístup. ⭐
        wildcard = full access (žádné limity).
      </p>

      <div className="flex flex-wrap gap-2">
        {tts.map((tt) => (
          <button
            key={tt.id}
            type="button"
            onClick={() => setActiveTtId(tt.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              activeTtId === tt.id
                ? 'border-violet-500 bg-violet-50 font-medium text-violet-900'
                : 'border-slate-300 bg-white text-slate-700'
            }`}
          >
            {tt.name} ({(tt.base_price / 100).toFixed(0)} Kč)
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={setWildcardAll}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          ⭐ Všechny dny × všechny zóny
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="rounded-md bg-rose-100 px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-200"
        >
          🗑 Vyprázdnit
        </button>
      </div>

      {hasWildcardAll && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          ⭐ Wildcard aktivní — tento ticket má přístup na všechny dny ×
          všechny zóny. Konkrétní cells níže jsou ignorovány.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-testid="access-matrix-table">
          <thead>
            <tr>
              <th className="border bg-slate-100 p-2 text-left">Den \ Zóna</th>
              {zones.map((z) => (
                <th key={z.id} className="border bg-slate-100 p-2 text-center">
                  <button
                    type="button"
                    onClick={() => selectWholeZone(z.id)}
                    className="font-medium hover:text-violet-700"
                    title="Zaškrtni celou zónu napříč dny"
                  >
                    {z.name}
                  </button>
                  <div className="text-[10px] font-normal text-slate-500">
                    {z.zone_type}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.id}>
                <td className="border bg-slate-50 p-2">
                  <button
                    type="button"
                    onClick={() => selectWholeDay(d.id)}
                    className="font-medium hover:text-violet-700"
                    title="Zaškrtni celý den napříč zónami"
                  >
                    Den {d.day_index + 1}
                    {d.label ? ` — ${d.label}` : ''}
                  </button>
                  <div className="text-[10px] font-normal text-slate-500">
                    {new Date(d.starts_at).toLocaleDateString('cs-CZ')}
                  </div>
                </td>
                {zones.map((z) => {
                  const checked = hasAccess(d.id, z.id);
                  return (
                    <td
                      key={`${d.id}-${z.id}`}
                      className={`border p-3 text-center ${checked ? 'bg-emerald-50' : 'bg-white'} cursor-pointer hover:bg-violet-50`}
                      onClick={() => toggleCell(d.id, z.id)}
                      data-testid={`access-cell-${d.id}-${z.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        readOnly
                        className="h-4 w-4 cursor-pointer accent-emerald-600"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
          data-testid="access-matrix-save"
        >
          {saving ? 'Ukládám…' : 'Uložit matrix'}
        </button>
        {msg && (
          <span className="text-xs text-slate-600" data-testid="access-matrix-msg">
            {msg}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Tip: klikni na hlavičku zóny nebo dne pro hromadné označení celého
        řádku / sloupce. Wildcard ⭐ smaže všechny detailní cells a nahradí je
        jedním all/all rowem.
      </p>
    </div>
  );
}
