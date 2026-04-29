'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Plus, Trash2, Pencil, CalendarDays } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface Day {
  id: string;
  dayIndex: number;
  startsAt: string;
  endsAt: string;
  label: string | null;
  notes: string | null;
  redemptionCount: number;
}

interface TicketType {
  id: string;
  name: string;
  basePrice: number;
}

interface FlexSettings {
  exists: boolean;
  picksRequired?: number;
  passKind?: 'flex' | 'season';
  pickDeadline?: string | null;
  notes?: string | null;
}

const PASS_KIND_LABEL: Record<string, string> = {
  flex: 'Flex pass — kupec si vybírá termíny při check-inu',
  season: 'Sezónní permanentka — automaticky vstup na všechny dny',
};

export default function SeasonBuilderPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [days, setDays] = useState<Day[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [flexSettings, setFlexSettings] = useState<Record<string, FlexSettings>>({});

  // Add day form
  const [showAddDay, setShowAddDay] = useState(false);
  const [dayLabel, setDayLabel] = useState('');
  const [dayStarts, setDayStarts] = useState('');
  const [dayEnds, setDayEnds] = useState('');
  const [dayNotes, setDayNotes] = useState('');
  const [editingDayId, setEditingDayId] = useState<string | null>(null);

  // Flex pass settings form
  const [editingTtId, setEditingTtId] = useState<string | null>(null);
  const [picksRequired, setPicksRequired] = useState('6');
  const [passKind, setPassKind] = useState<'flex' | 'season'>('flex');

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function reload() {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const daysRes = await fetch(`/api/admin/events/${eventId}/days`, { headers });
    if (daysRes.ok) {
      const d = (await daysRes.json()) as { days: Day[] };
      setDays(d.days);
    }
    const evRes = await fetch(`/api/events/${eventId}/ticket-types`, { headers }).catch(() => null);
    if (evRes && evRes.ok) {
      const ev = (await evRes.json()) as { ticketTypes: TicketType[] };
      setTicketTypes(ev.ticketTypes ?? []);
      // Pro každý ticket type načíst flex settings
      const fsMap: Record<string, FlexSettings> = {};
      await Promise.all(
        (ev.ticketTypes ?? []).map(async (tt) => {
          const r = await fetch(`/api/admin/ticket-types/${tt.id}/flex-settings`, { headers });
          if (r.ok) fsMap[tt.id] = await r.json();
        }),
      );
      setFlexSettings(fsMap);
    }
  }

  useEffect(() => {
    void reload();
  }, [eventId]);

  async function handleSaveDay(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    const token = localStorage.getItem('accessToken');
    const url = editingDayId
      ? `/api/admin/events/${eventId}/days/${editingDayId}`
      : `/api/admin/events/${eventId}/days`;
    const r = await fetch(url, {
      method: editingDayId ? 'PATCH' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        label: dayLabel || null,
        startsAt: new Date(dayStarts).toISOString(),
        endsAt: new Date(dayEnds).toISOString(),
        notes: dayNotes || null,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      setError(d.message ?? d.error);
      return;
    }
    setFeedback(editingDayId ? 'Den upraven.' : `Den "${dayLabel}" přidán.`);
    setShowAddDay(false);
    setEditingDayId(null);
    setDayLabel('');
    setDayStarts('');
    setDayEnds('');
    setDayNotes('');
    await reload();
  }

  function startEditDay(day: Day) {
    setEditingDayId(day.id);
    setDayLabel(day.label ?? '');
    setDayStarts(day.startsAt.slice(0, 16));
    setDayEnds(day.endsAt.slice(0, 16));
    setDayNotes(day.notes ?? '');
    setShowAddDay(true);
  }

  async function handleDeleteDay(day: Day) {
    if (!window.confirm(`Smazat den "${day.label ?? day.startsAt}"?`)) return;
    const token = localStorage.getItem('accessToken');
    const r = await fetch(`/api/admin/events/${eventId}/days/${day.id}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      const d = await r.json();
      setError(d.message ?? d.error);
    } else {
      setFeedback('Den smazán.');
      await reload();
    }
  }

  async function saveFlexSettings(ttId: string) {
    const token = localStorage.getItem('accessToken');
    const r = await fetch(`/api/admin/ticket-types/${ttId}/flex-settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        picksRequired: parseInt(picksRequired, 10),
        passKind,
      }),
    });
    if (!r.ok) {
      const d = await r.json();
      setError(d.message ?? d.error);
    } else {
      setFeedback('Flex pass nastavení uloženo.');
      setEditingTtId(null);
      await reload();
    }
  }

  async function clearFlexSettings(ttId: string) {
    if (!window.confirm('Odstranit flex/season pass nastavení? Z toho se stane normální single-use vstupenka.')) return;
    const token = localStorage.getItem('accessToken');
    await fetch(`/api/admin/ticket-types/${ttId}/flex-settings`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sezóna / Permanentka"
        description="Postupně přidávej termíny (zápasy / představení / lekce). Definuj flex pass nebo season pass na ticket typy."
        actions={
          <Link
            href={`/admin/events`}
            className="text-xs text-primary hover:underline"
          >
            ← Zpět na akce
          </Link>
        }
      />

      {feedback ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          {feedback}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* Days section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Termíny ({days.length})
          </CardTitle>
          <CardDescription>
            Postupně přidávej termíny po rozlosování. Každý termín = 1 zápas / představení / lekce.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {showAddDay ? (
            <form onSubmit={handleSaveDay} className="grid grid-cols-1 gap-3 md:grid-cols-2 mb-4">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Popisek (např. „1. kolo: Sparta vs. Plzeň")</label>
                <Input
                  value={dayLabel}
                  onChange={(e) => setDayLabel(e.target.value)}
                  placeholder="1. kolo · Sparta vs. Slavia"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Začátek *</label>
                <Input
                  type="datetime-local"
                  value={dayStarts}
                  onChange={(e) => setDayStarts(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Konec *</label>
                <Input
                  type="datetime-local"
                  value={dayEnds}
                  onChange={(e) => setDayEnds(e.target.value)}
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Poznámky</label>
                <textarea
                  className="flex min-h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={dayNotes}
                  onChange={(e) => setDayNotes(e.target.value)}
                  placeholder="Speciální informace pro tento termín"
                />
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit">{editingDayId ? 'Uložit změny' : 'Přidat termín'}</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowAddDay(false);
                    setEditingDayId(null);
                    setDayLabel('');
                    setDayStarts('');
                    setDayEnds('');
                    setDayNotes('');
                  }}
                >
                  Zrušit
                </Button>
              </div>
            </form>
          ) : (
            <Button onClick={() => setShowAddDay(true)} className="mb-4 gap-1">
              <Plus className="h-4 w-4" /> Přidat termín
            </Button>
          )}

          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Žádné termíny. Přidej první termín pro start sezóny.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">#</th>
                  <th>Popisek</th>
                  <th>Termín</th>
                  <th className="text-right">Check-iny</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.id} className="border-b">
                    <td className="py-2 text-xs text-muted-foreground">
                      {d.dayIndex + 1}
                    </td>
                    <td className="font-medium">{d.label ?? '—'}</td>
                    <td className="text-xs text-muted-foreground">
                      {new Date(d.startsAt).toLocaleString('cs-CZ', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      {' – '}
                      {new Date(d.endsAt).toLocaleString('cs-CZ', {
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="text-right">
                      {d.redemptionCount > 0 ? (
                        <span className="text-emerald-700">{d.redemptionCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => startEditDay(d)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-700 hover:bg-rose-50"
                        onClick={() => handleDeleteDay(d)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Flex pass settings per ticket type */}
      <Card>
        <CardHeader>
          <CardTitle>Permanentky — typy vstupenek</CardTitle>
          <CardDescription>
            Pro každý ticket type můžeš nastavit, jestli je <strong>flex pass</strong> (kupec si vybírá termíny) nebo <strong>season pass</strong> (vstup na všechny).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {ticketTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Tato akce nemá žádné typy vstupenek (možná endpoint /api/events/[id]/ticket-types ještě neexistuje).
            </p>
          ) : (
            <div className="space-y-3">
              {ticketTypes.map((tt) => {
                const fs = flexSettings[tt.id] ?? { exists: false };
                const isEditing = editingTtId === tt.id;
                return (
                  <div key={tt.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium">{tt.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {(tt.basePrice / 100).toLocaleString('cs-CZ')} Kč
                        </div>
                        {fs.exists ? (
                          <div className="mt-1 text-xs text-emerald-700">
                            ✓ {PASS_KIND_LABEL[fs.passKind ?? 'flex']}
                            {fs.passKind === 'flex' && fs.picksRequired
                              ? ` · vybírá ${fs.picksRequired} z ${days.length}`
                              : ''}
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Single-use vstupenka (žádná permanentka)
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {!isEditing ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingTtId(tt.id);
                              setPicksRequired(String(fs.picksRequired ?? Math.min(6, days.length || 1)));
                              setPassKind(fs.passKind ?? 'flex');
                            }}
                          >
                            {fs.exists ? 'Upravit' : 'Nastavit jako pass'}
                          </Button>
                        ) : null}
                        {fs.exists && !isEditing ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-rose-700 hover:bg-rose-50"
                            onClick={() => clearFlexSettings(tt.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {isEditing ? (
                      <div className="mt-3 space-y-2 rounded bg-muted/30 p-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium">Typ permanentky</label>
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                            value={passKind}
                            onChange={(e) => setPassKind(e.target.value as 'flex' | 'season')}
                          >
                            <option value="flex">Flex pass (vyber N z M)</option>
                            <option value="season">Season pass (vstup na všechny)</option>
                          </select>
                        </div>
                        {passKind === 'flex' ? (
                          <div>
                            <label className="mb-1 block text-xs font-medium">
                              Počet termínů (kupec vybere) z celkem {days.length}
                            </label>
                            <Input
                              type="number"
                              min={1}
                              max={Math.max(days.length, 1)}
                              value={picksRequired}
                              onChange={(e) => setPicksRequired(e.target.value)}
                            />
                          </div>
                        ) : null}
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveFlexSettings(tt.id)}>
                            Uložit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingTtId(null)}
                          >
                            Zrušit
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
