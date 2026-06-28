'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';

function authFetch(url: string, init?: RequestInit) {
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

interface Zone {
  id: string; name: string; code: string; capacity: number | null; occupancy: number;
}

interface LogEntry {
  id: string; wristband_uid: string; direction: string; result: string;
  scanned_at: string; zone_name: string | null; zone_code: string | null;
}

interface Stats {
  zones: Zone[]; totalInside: number; recentLog: LogEntry[]; ts: string;
}

const RESULT_STYLE: Record<string, string> = {
  admitted: 'text-emerald-700',
  denied_anti_passback: 'text-amber-700',
  denied_zone_full: 'text-orange-700',
  denied_not_authorized: 'text-rose-700',
  denied_no_wristband: 'text-rose-700',
  denied_inactive: 'text-gray-500',
};

const RESULT_LABEL: Record<string, string> = {
  admitted: '✅ Vpuštěn',
  denied_anti_passback: '⚠️ Už uvnitř',
  denied_zone_full: '🚫 Zóna plná',
  denied_not_authorized: '⛔ Neautorizován',
  denied_no_wristband: '❓ Neznámý',
  denied_inactive: '🔒 Neaktivní',
};

export default function RfidLivePage() {
  const params = useParams();
  const eventId = String(params.id);
  const [stats, setStats] = useState<Stats | null>(null);
  const [interval] = useState(3000);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/rfid/stats`);
      if (r.ok) setStats(await r.json() as Stats);
    } catch { /* silent */ }
  }, [eventId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(); }, interval);
    return () => clearInterval(t);
  }, [load, interval]);

  const totalCapacity = stats?.zones.reduce((s, z) => s + (z.capacity ?? 0), 0) ?? 0;
  const fillPct = totalCapacity > 0 ? Math.min(100, ((stats?.totalInside ?? 0) / totalCapacity) * 100) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID Live Dashboard"
        description="Obsazenost zón v reálném čase · aktualizuje se každé 3 sekundy"
      />

      {/* Total occupancy */}
      <div className="rounded-xl border bg-card p-5 flex items-center gap-6">
        <div>
          <p className="text-xs text-muted-foreground uppercase font-medium mb-1">Celkem uvnitř</p>
          <p className="text-5xl font-black tabular-nums">{stats?.totalInside ?? '—'}</p>
        </div>
        {fillPct !== null && (
          <div className="flex-1">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Celková kapacita</span>
              <span>{Math.round(fillPct)}%</span>
            </div>
            <div className="h-4 rounded-full bg-muted overflow-hidden">
              <div
                className="h-4 rounded-full transition-all duration-500"
                style={{
                  width: `${fillPct}%`,
                  background: fillPct > 90 ? '#ef4444' : fillPct > 70 ? '#f59e0b' : '#10b981',
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{stats?.totalInside} / {totalCapacity}</p>
          </div>
        )}
        {stats?.ts && (
          <div className="text-xs text-muted-foreground text-right">
            <div className="flex items-center gap-1 justify-end">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </div>
            <div>{new Date(stats.ts).toLocaleTimeString('cs-CZ')}</div>
          </div>
        )}
      </div>

      {/* Per-zone cards */}
      {stats && stats.zones.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {stats.zones.map(z => {
            const pct = z.capacity ? Math.min(100, (z.occupancy / z.capacity) * 100) : null;
            const statusColor =
              pct === null ? 'border-border' :
              pct > 90 ? 'border-red-400 bg-red-50' :
              pct > 70 ? 'border-amber-400 bg-amber-50' :
              'border-emerald-400 bg-emerald-50';
            return (
              <div key={z.id} className={`rounded-xl border-2 p-4 ${statusColor}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-muted-foreground">{z.code}</span>
                  {pct !== null && (
                    <span className={`text-xs font-bold ${pct > 90 ? 'text-red-700' : pct > 70 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {Math.round(pct)}%
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium truncate">{z.name}</p>
                <p className="text-3xl font-black tabular-nums mt-1">{z.occupancy}</p>
                {z.capacity && (
                  <>
                    <div className="mt-2 h-1.5 rounded-full bg-black/10 overflow-hidden">
                      <div className="h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: pct! > 90 ? '#dc2626' : pct! > 70 ? '#d97706' : '#059669' }} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">/ {z.capacity}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border p-8 text-center text-muted-foreground text-sm">
          {stats ? 'Žádné zóny. Nastav je v záložce Zóny & Zařízení.' : 'Načítám…'}
        </div>
      )}

      {/* Recent log */}
      {stats && stats.recentLog.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3">Posledních 20 skenů</h3>
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Čas</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">UID</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Zóna</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Směr</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Výsledek</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stats.recentLog.map(e => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                      {new Date(e.scanned_at).toLocaleTimeString('cs-CZ')}
                    </td>
                    <td className="px-3 py-1.5 font-mono">{e.wristband_uid.slice(0, 12)}</td>
                    <td className="px-3 py-1.5">
                      {e.zone_code ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold">{e.zone_code}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-1.5">{e.direction === 'in' ? '→ IN' : '← OUT'}</td>
                    <td className={`px-3 py-1.5 font-medium ${RESULT_STYLE[e.result] ?? ''}`}>
                      {RESULT_LABEL[e.result] ?? e.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
