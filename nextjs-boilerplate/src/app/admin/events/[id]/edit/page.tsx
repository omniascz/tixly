'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EventData {
  id: string;
  title: string;
  description: string | null;
  dateStart: string;
  status: string;
  minAge: number | null;
}

export default function EditEventPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [data, setData] = useState<EventData | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [minAge, setMinAge] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    fetch(`/api/admin/events/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d: EventData) => {
        setData(d);
        setTitle(d.title);
        setDescription(d.description ?? '');
        setDateStart(d.dateStart.slice(0, 16));
        setMinAge(d.minAge ? String(d.minAge) : '');
      })
      .catch(() => setError('Nelze načíst akci'));
  }, [id]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const r = await fetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: title !== data?.title ? title : undefined,
          description: description !== (data?.description ?? '') ? description : undefined,
          dateStart:
            new Date(dateStart).toISOString() !== data?.dateStart
              ? new Date(dateStart).toISOString()
              : undefined,
          minAge: minAge ? parseInt(minAge, 10) : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? `HTTP ${r.status}`);
        return;
      }
      setFeedback(
        d.status === 'rejected'
          ? 'Edit byl zamítnut moderation gate. Akce je ve stavu rejected.'
          : d.status === 'pending_review'
            ? 'Změny uloženy, akce čeká na schválení.'
            : 'Změny uloženy.',
      );
      setTimeout(() => router.push('/admin/events'), 1500);
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-2xl text-sm text-muted-foreground">
        {error ?? 'Načítám…'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Upravit akci</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Název</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                minLength={2}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Změna spustí re-moderation (AI gate + keyword check).
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <textarea
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Datum a čas</label>
                <Input
                  type="datetime-local"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Min věk (volit.)</label>
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                />
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {feedback && (
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
                {feedback}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>
                {loading ? 'Ukládám…' : 'Uložit změny'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/admin/events')}
              >
                Zrušit
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
