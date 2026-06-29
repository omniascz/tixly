'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface Gate {
  id: string;
  code: string;
  label: string;
  description: string | null;
  is_accessible: boolean;
  sort_order: number;
}

interface GateStat {
  gate_id: string;
  gate_label: string;
  scanned_today: number;
  total_scanned: number;
  unique_tickets: number;
}

interface TicketType {
  id: string;
  name: string;
}

interface GateAssignment {
  gate_id: string;
  ticket_type_id: string;
}

export default function GatesManagementPage() {
  const { id: eventId } = useParams<{ id: string }>();
  const [gates, setGates] = useState<Gate[]>([]);
  const [stats, setStats] = useState<GateStat[]>([]);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [assignments, setAssignments] = useState<GateAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  function authFetch(url: string, init?: RequestInit) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
    return fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(userId ? { 'x-user-id': userId } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  const load = useCallback(async () => {
    const [gatesR, statsR, typesR, assignR] = await Promise.all([
      authFetch(`/api/admin/events/${eventId}/gates`).then(r => r.ok ? r.json() as Promise<{ gates: Gate[] }> : { gates: [] }),
      authFetch(`/api/admin/events/${eventId}/scan-stats`).then(r => r.ok ? r.json() as Promise<{ stats: GateStat[] }> : { stats: [] }),
      authFetch(`/api/admin/events/${eventId}/ticket-types`).then(r => r.ok ? r.json() as Promise<{ ticketTypes: TicketType[] }> : { ticketTypes: [] }),
      authFetch(`/api/admin/events/${eventId}/gate-assignments`).then(r => r.ok ? r.json() as Promise<{ assignments: GateAssignment[] }> : { assignments: [] }),
    ]);
    setGates(gatesR.gates ?? []);
    setStats(statsR.stats ?? []);
    setTypes(typesR.ticketTypes ?? []);
    setAssignments(assignR.assignments ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function toggleAssignment(gateId: string, typeId: string) {
    const exists = assignments.some(a => a.gate_id === gateId && a.ticket_type_id === typeId);
    await authFetch(`/api/admin/events/${eventId}/gate-assignments`, {
      method: exists ? 'DELETE' : 'POST',
      body: JSON.stringify({ gateId, ticketTypeId: typeId }),
    });
    await load();
  }

  if (loading) return <div className="p-8 text-gray-500">Načítám brány...</div>;

  const totalScanned = stats.reduce((s, g) => s + g.total_scanned, 0);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Správa vstupních bran</h1>

      {/* Overview stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-3xl font-bold">{totalScanned}</div>
          <div className="text-gray-400 text-sm">Celkem naskenováno</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-3xl font-bold">{gates.length}</div>
          <div className="text-gray-400 text-sm">Aktivní brány</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-3xl font-bold">{stats.reduce((s, g) => s + g.scanned_today, 0)}</div>
          <div className="text-gray-400 text-sm">Dnes naskenováno</div>
        </div>
        <div className="bg-gray-900 rounded-xl p-4">
          <div className="text-3xl font-bold">{types.length}</div>
          <div className="text-gray-400 text-sm">Typy vstupenek</div>
        </div>
      </div>

      {/* Per-gate stats */}
      {stats.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Statistiky bran</h2>
          <div className="space-y-2">
            {stats.map(s => {
              const total = stats.reduce((acc, g) => acc + g.total_scanned, 0);
              const pct = total > 0 ? Math.round(s.total_scanned / total * 100) : 0;
              return (
                <div key={s.gate_id} className="bg-gray-900 rounded-xl p-4">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-medium">{s.gate_label}</span>
                    <span className="text-sm text-gray-400">{s.total_scanned} celkem ({s.scanned_today} dnes)</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gate assignments */}
      {gates.length > 0 && types.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Přiřazení vstupenek k bránám</h2>
          <p className="text-sm text-gray-400 mb-4">
            Definuj, které typy vstupenek jsou platné na každé bráně.
            Pokud není nic přiřazeno, brána akceptuje všechny.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-2 pr-4 text-gray-400 font-medium">Brána</th>
                  {types.map(tt => (
                    <th key={tt.id} className="text-center py-2 px-2 text-gray-400 font-medium text-xs">
                      {tt.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gates.map(gate => (
                  <tr key={gate.id} className="border-b border-gray-800/50">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{gate.label}</div>
                      <div className="text-xs text-gray-500">{gate.code}</div>
                      {gate.is_accessible && <div className="text-xs text-blue-400">♿ Bezbariérová</div>}
                    </td>
                    {types.map(tt => {
                      const assigned = assignments.some(a => a.gate_id === gate.id && a.ticket_type_id === tt.id);
                      return (
                        <td key={tt.id} className="text-center py-3 px-2">
                          <button
                            onClick={() => void toggleAssignment(gate.id, tt.id)}
                            className={`w-6 h-6 rounded transition-colors ${
                              assigned ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-600 hover:bg-gray-700'
                            }`}
                          >
                            {assigned ? '✓' : '·'}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {gates.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-3">🚪</div>
          <p>Žádné brány nejsou definovány pro toto místo konání.</p>
        </div>
      )}
    </div>
  );
}
