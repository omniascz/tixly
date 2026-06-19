'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface BackstageMoment {
  event_id: string;
  video_url: string;
  thumbnail_url: string | null;
  title: string | null;
  description: string | null;
  notify_minutes_before: number;
  is_active: boolean;
  updated_at: string | null;
}

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

export default function BackstagePage() {
  const params = useParams();
  const eventId = String(params.id);

  const [moment, setMoment] = useState<BackstageMoment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [videoUrl, setVideoUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [title, setTitle] = useState('Zákulisí dnešního večera');
  const [description, setDescription] = useState('');
  const [notifyMinutesBefore, setNotifyMinutesBefore] = useState(10);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      setLoading(true);
      try {
        const res = await authFetch(`/api/admin/events/${eventId}/backstage`);
        if (res.ok) {
          const j = (await res.json()) as { moment: BackstageMoment | null };
          if (j.moment) {
            setMoment(j.moment);
            setVideoUrl(j.moment.video_url);
            setThumbnailUrl(j.moment.thumbnail_url ?? '');
            setTitle(j.moment.title ?? 'Zákulisí dnešního večera');
            setDescription(j.moment.description ?? '');
            setNotifyMinutesBefore(j.moment.notify_minutes_before);
            setIsActive(j.moment.is_active);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }, [eventId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/backstage`, {
        method: 'POST',
        body: JSON.stringify({
          videoUrl,
          thumbnailUrl: thumbnailUrl || undefined,
          title,
          description: description || undefined,
          notifyMinutesBefore,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { moment?: BackstageMoment; error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setMoment(j.moment ?? null);
      setFeedback('Backstage moment uložen.');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle() {
    if (!moment) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const next = !isActive;
      const res = await authFetch(`/api/admin/events/${eventId}/backstage`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      const j = (await res.json().catch(() => ({}))) as { moment?: BackstageMoment; error?: string };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setIsActive(next);
      setMoment(j.moment ?? null);
      setFeedback(next ? 'Backstage moment aktivován.' : 'Backstage moment deaktivován.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Opravdu smazat backstage moment?')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/backstage`, { method: 'DELETE' });
      if (res.ok) {
        setMoment(null);
        setVideoUrl('');
        setThumbnailUrl('');
        setTitle('Zákulisí dnešního večera');
        setDescription('');
        setNotifyMinutesBefore(10);
        setIsActive(false);
        setFeedback('Backstage moment smazán.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleNotify() {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/admin/backstage/notify`, {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      });
      const j = (await res.json().catch(() => ({}))) as { notified?: number; backstageUrl?: string; error?: string; message?: string };
      if (!res.ok) {
        setError(j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`Notifikace odeslána na ${j.notified} emailů. URL: ${j.backstageUrl ?? ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backstage moment"
        description="Video ze zákulisí posílané divákům 10 minut před začátkem."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Tixly pošle email + push notifikaci všem kupujícím {notifyMinutesBefore} minut před začátkem představení s odkazem na video.
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Načítám…</p>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Nastavení backstage momentu</CardTitle>
              {moment ? (
                <Badge variant={isActive ? 'default' : 'secondary'}>
                  {isActive ? 'Aktivní' : 'Neaktivní'}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  URL videa *
                </label>
                <Input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="YouTube, Vimeo nebo přímý MP4 link"
                  required
                  type="url"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  URL náhledového obrázku
                </label>
                <Input
                  value={thumbnailUrl}
                  onChange={(e) => setThumbnailUrl(e.target.value)}
                  placeholder="https://example.com/backstage-thumb.jpg"
                  type="url"
                />
                {thumbnailUrl ? (
                  <div className="mt-2 overflow-hidden rounded-md">
                    <img
                      src={thumbnailUrl}
                      alt="Náhled"
                      className="h-40 w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Název
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Zákulisí dnešního večera"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Popis
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Krátké zákulisní video pro diváky — přípravy, atmosféra před začátkem."
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Počet minut před začátkem
                </label>
                <Input
                  type="number"
                  value={notifyMinutesBefore}
                  onChange={(e) => setNotifyMinutesBefore(Number(e.target.value))}
                  min={1}
                  max={1440}
                  className="w-32"
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" disabled={busy || !videoUrl}>
                  {busy ? 'Ukládám…' : 'Uložit'}
                </Button>

                {moment ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={handleToggle}
                    >
                      {isActive ? 'Deaktivovat' : 'Aktivovat'}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={handleNotify}
                    >
                      Odeslat notifikaci teď
                    </Button>

                    <Button
                      type="button"
                      variant="destructive"
                      disabled={busy}
                      onClick={handleDelete}
                    >
                      Smazat
                    </Button>
                  </>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
