'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface StreamSettings {
  streaming_url:        string | null;
  streaming_provider:   string | null;
  stream_chat_url:      string | null;
  stream_recording_url: string | null;
  stream_replay_days:   number;
  event_type:           string | null;
}

function adminFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export default function StreamPage() {
  const { id } = useParams<{ id: string }>();
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [saved,    setSaved]    = useState(false);

  const [streamUrl,     setStreamUrl]     = useState('');
  const [provider,      setProvider]      = useState('');
  const [chatUrl,       setChatUrl]       = useState('');
  const [recordingUrl,  setRecordingUrl]  = useState('');
  const [replayDays,    setReplayDays]    = useState(0);

  useEffect(() => {
    void adminFetch(`/api/admin/events/${id}/stream`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stream: StreamSettings } | null) => {
        if (data?.stream) {
          const s = data.stream;
          setStreamUrl(s.streaming_url ?? '');
          setProvider(s.streaming_provider ?? '');
          setChatUrl(s.stream_chat_url ?? '');
          setRecordingUrl(s.stream_recording_url ?? '');
          setReplayDays(s.stream_replay_days ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {
        streaming_url:        streamUrl || null,
        streaming_provider:   provider || null,
        stream_chat_url:      chatUrl || null,
        stream_recording_url: recordingUrl || null,
        stream_replay_days:   replayDays,
      };
      const res = await adminFetch(`/api/admin/events/${id}/stream`, {
        method: 'PUT',
        body:   JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setError(err.error ?? `HTTP ${res.status}`);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Načítám…</p>;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Nastavení livestreamu"
        description="Nakonfiguruj online přenos pro tuto akci. URL bude přístupná pouze ověřeným vlastníkům vstupenek."
      />

      <Card>
        <CardHeader>
          <CardTitle>Stream URL</CardTitle>
          <CardDescription>
            Přímý odkaz na přehrávač (YouTube embed URL, Vimeo embed URL, nebo vlastní RTMP/HLS player).
            Tixly ho bezpečně zpřístupní pouze majitelům platných vstupenek.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">Streaming URL *</label>
            <Input
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="https://www.youtube.com/embed/..."
              type="url"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              YouTube: youtube.com/embed/VIDEO_ID · Vimeo: vimeo.com/event/ID/embed · Zoom: zoom.us/j/ID · Vlastní: vaše URL
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Platforma</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">— Zvolte platformu —</option>
              <option value="youtube">YouTube Live</option>
              <option value="vimeo">Vimeo</option>
              <option value="zoom">Zoom</option>
              <option value="custom">Vlastní / jiná</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Chat URL (volitelné)</label>
            <Input
              value={chatUrl}
              onChange={(e) => setChatUrl(e.target.value)}
              placeholder="https://..."
              type="url"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Otevře se ve druhém okně spolu se streamem (Slido, YouTube chat, apod.)
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Záznam (replay)</CardTitle>
          <CardDescription>
            URL záznamu můžeš doplnit po skončení akce. Přístupný pouze ticket typům s &apos;live_and_replay&apos; přístupem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium">URL záznamu</label>
            <Input
              value={recordingUrl}
              onChange={(e) => setRecordingUrl(e.target.value)}
              placeholder="https://..."
              type="url"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Přístup k záznamu (dní po skončení)</label>
            <Input
              value={replayDays}
              onChange={(e) => setReplayDays(Math.max(0, parseInt(e.target.value) || 0))}
              type="number"
              min={0}
              max={365}
              className="w-32"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              0 = bez replay · 7 = záznam dostupný 7 dní · max 365
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">{error}</p>
      )}
      {saved && (
        <p className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
          Uloženo!
        </p>
      )}

      <Button onClick={save} disabled={saving}>
        {saving ? 'Ukládám…' : 'Uložit nastavení streamu'}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Jak to funguje</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>1. Nastav streaming URL výše a ulož.</p>
          <p>2. Na stránce akce se zobrazí badge &quot;Online přenos&quot; a info pro kupující.</p>
          <p>3. Po zaplacení kupující vidí v Moje lístky tlačítko &quot;Sledovat stream&quot; — aktivuje se 15 min před začátkem.</p>
          <p>4. Stream URL je chráněna — přímý odkaz bez vstupenky nefunguje.</p>
          <p>5. Po skončení streamu zadej URL záznamu, aby ho bylo možné přehrát.</p>
          <p className="font-medium text-foreground">Typy vstupenek: v nastavení ticket typů můžeš zvolit, zda daný typ zahrnuje &quot;live&quot;, &quot;live + replay&quot;, nebo &quot;bez streamu&quot; (fyzická vstupenka).</p>
        </CardContent>
      </Card>
    </div>
  );
}
