'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Experience {
  id: string; name: string; description: string | null; type: string;
  capacity: number; reserved_count: number; price_halire: number; currency: string;
  requires_ticket: boolean; start_time: string | null; location: string | null;
  what_to_expect: string | null; cover_image_url: string | null;
  booking_deadline: string | null; active: boolean; created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  meet_greet: 'Meet & Greet',
  soundcheck: 'Soundcheck',
  backstage_tour: 'Backstage tour',
  vip_lounge: 'VIP lounge',
  after_party: 'After party',
};

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

export default function SuperfanPage() {
  const params = useParams();
  const eventId = String(params.id);

  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('meet_greet');
  const [capacity, setCapacity] = useState('10');
  const [priceKc, setPriceKc] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [bookingDeadline, setBookingDeadline] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/superfan-experiences`);
      const d = await r.json() as { experiences?: Experience[] };
      setExperiences(d.experiences ?? []);
    } catch {
      setError('Nepodařilo se načíst zážitky.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [eventId]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await authFetch(`/api/admin/events/${eventId}/superfan-experiences`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          type,
          capacity: parseInt(capacity, 10),
          priceHalire: Math.round(parseFloat(priceKc || '0') * 100),
          description: description || undefined,
          location: location || undefined,
          startTime: startTime ? new Date(startTime).toISOString() : undefined,
          bookingDeadline: bookingDeadline ? new Date(bookingDeadline).toISOString() : undefined,
          requiresTicket: true,
        }),
      });
      if (!r.ok) { const d = await r.json() as { error?: string }; setError(d.error ?? 'Chyba'); return; }
      setName(''); setType('meet_greet'); setCapacity('10'); setPriceKc('');
      setDescription(''); setLocation(''); setStartTime(''); setBookingDeadline('');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (exp: Experience) => {
    setSaving(true);
    try {
      await authFetch(
        `/api/admin/events/${eventId}/superfan-experiences?expId=${exp.id}`,
        { method: 'PATCH', body: JSON.stringify({ active: !exp.active }) },
      );
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Super Fan zážitky"
        description="Meet & greet, soundcheck, backstage tour a VIP zážitky pro fanoušky"
        actions={
          <Button onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Zrušit' : '+ Přidat zážitek'}
          </Button>
        }
      />

      {error ? <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {showForm ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Nový Super Fan zážitek</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Název *</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Meet & Greet s umělcem" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Typ *</label>
                <select
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kapacita (počet míst) *</label>
                <Input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Cena (Kč) *</label>
                <Input type="number" min={0} step={0.01} value={priceKc} onChange={(e) => setPriceKc(e.target.value)} required placeholder="990" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Místo</label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Backstage sál B" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Čas začátku</label>
                <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Uzávěrka rezervací</label>
                <Input type="datetime-local" value={bookingDeadline} onChange={(e) => setBookingDeadline(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Popis</label>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Co fanoušky čeká…"
                />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Zrušit</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Ukládám…' : 'Vytvořit'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : experiences.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Žádné Super Fan zážitky. Klikni &quot;+ Přidat zážitek&quot; výše.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {experiences.map((exp) => {
            const spotsLeft = exp.capacity - exp.reserved_count;
            return (
              <Card key={exp.id} className={exp.active ? '' : 'opacity-60'}>
                <CardContent className="flex items-start justify-between gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{exp.name}</span>
                      <Badge variant="outline">{TYPE_LABEL[exp.type] ?? exp.type}</Badge>
                      {exp.active ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">Aktivní</Badge>
                      ) : (
                        <Badge variant="outline" className="text-gray-500">Neaktivní</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                      <span>💰 {(exp.price_halire / 100).toLocaleString('cs-CZ')} Kč</span>
                      <span>👥 {exp.reserved_count}/{exp.capacity} obsazeno ({spotsLeft} zbývá)</span>
                      {exp.location ? <span>📍 {exp.location}</span> : null}
                      {exp.start_time ? (
                        <span>🕐 {new Date(exp.start_time).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      ) : null}
                    </div>
                    {exp.description ? <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{exp.description}</p> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => toggleActive(exp)}
                  >
                    {exp.active ? 'Deaktivovat' : 'Aktivovat'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
