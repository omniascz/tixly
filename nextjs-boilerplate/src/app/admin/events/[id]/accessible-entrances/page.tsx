'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Accessibility, DoorOpen, Save, Info } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Zone {
  id: string;
  name: string;
  zone_type: string | null;
  accessible_gate_id: string | null;
  accessible_gate_label: string | null;
  accessible_gate_code: string | null;
  accessible_gate_notes: string | null;
  gate_is_accessible: boolean | null;
}

interface Gate {
  id: string;
  code: string;
  label: string;
  is_accessible: boolean;
}

interface ZoneState {
  accessibleGateId: string | null;
  accessibleGateNotes: string;
  dirty: boolean;
  saving: boolean;
}

export default function AccessibleEntrancesPage() {
  const { id } = useParams<{ id: string }>();
  const [zones, setZones]   = useState<Zone[]>([]);
  const [gates, setGates]   = useState<Gate[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, ZoneState>>({});
  const [loading, setLoading] = useState(true);

  // Load event → venue → gates + zones
  useEffect(() => {
    async function init() {
      // 1) Get venue_id from event
      const evR = await fetch(`/api/admin/events/${id}`);
      if (evR.ok) {
        const ev = await evR.json() as { event?: { venue_id?: string } };
        const vid = ev.event?.venue_id ?? null;
        setVenueId(vid);

        // 2) Load gates for this venue
        if (vid) {
          const gr = await fetch(`/api/admin/venues/${vid}/gates`);
          if (gr.ok) {
            const gd = await gr.json() as { gates: Gate[] };
            setGates(gd.gates);
          }
        }
      }

      // 3) Load zones with accessible gate assignments
      const zr = await fetch(`/api/admin/events/${id}/accessible-entrances`);
      if (zr.ok) {
        const zd = await zr.json() as { zones: Zone[] };
        setZones(zd.zones);
        const s: Record<string, ZoneState> = {};
        for (const z of zd.zones) {
          s[z.id] = {
            accessibleGateId:    z.accessible_gate_id,
            accessibleGateNotes: z.accessible_gate_notes ?? '',
            dirty: false,
            saving: false,
          };
        }
        setStates(s);
      }

      setLoading(false);
    }
    void init();
  }, [id]);

  function updateState(zoneId: string, patch: Partial<ZoneState>) {
    setStates((prev) => ({ ...prev, [zoneId]: { ...prev[zoneId], ...patch, dirty: true } }));
  }

  async function save(zoneId: string) {
    const st = states[zoneId];
    if (!st) return;
    setStates((p) => ({ ...p, [zoneId]: { ...p[zoneId], saving: true } }));
    await fetch(`/api/admin/events/${id}/accessible-entrances`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoneId,
        accessibleGateId:    st.accessibleGateId,
        accessibleGateNotes: st.accessibleGateNotes || null,
      }),
    });
    setStates((p) => ({ ...p, [zoneId]: { ...p[zoneId], saving: false, dirty: false } }));
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Načítám zóny…</div>;
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      <PageHeader
        title="Bezbariérové přístupy"
        description="Přiřaďte fyzický vstup ke každé zóně nebo sektoru akce. Informace se zobrazí na vstupence."
      />

      {/* No venue = no gates possible */}
      {!venueId && (
        <div className="rounded-lg border border-dashed p-6 flex items-start gap-3">
          <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Tato akce nemá přiřazen sál. Bezbariérové přístupy lze konfigurovat jen u akcí s mapou sedadel.
          </div>
        </div>
      )}

      {venueId && gates.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200">Sál nemá definovány žádné vstupy.</p>
            <p className="text-amber-700 dark:text-amber-300 mt-0.5">
              Nejprve přidejte fyzické vstupy v sekci{' '}
              <a href={`/admin/venues/${venueId}/gates`} className="underline font-medium">
                Sál → Vstupy / brány
              </a>.
            </p>
          </div>
        </div>
      )}

      {zones.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Tato akce nemá žádné zóny. Přidejte zóny v nastavení akce.
        </div>
      )}

      {/* Zone list */}
      <div className="space-y-3">
        {zones.map((z) => {
          const st = states[z.id];
          if (!st) return null;
          const isAccZone = z.zone_type === 'accessibility';
          const assignedGate = gates.find((g) => g.id === st.accessibleGateId);

          return (
            <div key={z.id} className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isAccZone
                    ? <Accessibility className="h-5 w-5 text-emerald-500" />
                    : <DoorOpen className="h-5 w-5 text-muted-foreground" />
                  }
                  <span className="font-medium">{z.name}</span>
                  {isAccZone && (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">
                      Bezbariérová zóna
                    </Badge>
                  )}
                </div>
                {assignedGate && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {assignedGate.code} — {assignedGate.label}
                    {assignedGate.is_accessible && ' ♿'}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    Přidělený vstup
                  </label>
                  <select
                    value={st.accessibleGateId ?? ''}
                    onChange={(e) => updateState(z.id, { accessibleGateId: e.target.value || null })}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    disabled={gates.length === 0}
                  >
                    <option value="">— žádný —</option>
                    {gates.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.code} — {g.label}{g.is_accessible ? ' ♿' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    Poznámka pro návštěvníky
                  </label>
                  <input
                    value={st.accessibleGateNotes}
                    onChange={(e) => updateState(z.id, { accessibleGateNotes: e.target.value })}
                    placeholder="Výtah v hale B, prosím přijďte 20 min dříve…"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              {st.dirty && (
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => void save(z.id)} disabled={st.saving}>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    {st.saving ? 'Ukládám…' : 'Uložit'}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Info box */}
      {zones.length > 0 && (
        <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground flex items-start gap-2">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Přidělené vstupy se zobrazí na vstupenke pod sekcí &ldquo;Vstup&rdquo; a e-mailem odeslaném kupujícímu.
            Bezbariérové vstupy (♿) jsou označeny i na SVG mapě sálu.
          </span>
        </div>
      )}
    </div>
  );
}
