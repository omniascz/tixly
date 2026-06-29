'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface StreamData {
  streaming_url: string;
  streaming_provider: string | null;
  stream_chat_url: string | null;
  stream_recording_url: string | null;
  is_replay: boolean;
  replay_expires_at: string | null;
  event_title: string;
}

type LoadState = 'loading' | 'ok' | 'not_yet' | 'expired' | 'no_access' | 'error';

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function extractVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? m[1] : null;
}

export default function WatchPage() {
  const params = useParams();
  const ticketId = params?.ticketId as string;
  const locale = (params?.locale as string) ?? 'cs';

  const [state, setLoadState] = useState<LoadState>('loading');
  const [data, setData] = useState<StreamData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) return;
    fetch(`/api/buyer/tickets/${ticketId}/stream-access`)
      .then(async (r) => {
        if (r.status === 403) { setLoadState('no_access'); return; }
        const d = await r.json();
        if (!r.ok) {
          if (d.error === 'NOT_YET') { setLoadState('not_yet'); return; }
          if (d.error === 'STREAM_ENDED') { setLoadState('expired'); return; }
          setError(d.message ?? 'Nastala chyba.'); setLoadState('error'); return;
        }
        setData(d as StreamData);
        setLoadState('ok');
      })
      .catch(() => { setError('Síťová chyba.'); setLoadState('error'); });
  }, [ticketId]);

  if (state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-white border-t-transparent" />
      </div>
    );
  }

  if (state === 'no_access') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-xl font-bold">Přístup zamítnut</p>
        <p className="text-sm text-gray-400">Tato vstupenka nemá přístup ke streamu, nebo jste nepřihlášeni.</p>
        <Button asChild variant="outline" className="border-white text-white hover:bg-white/10">
          <Link href={`/${locale}/my-tickets`}>Moje vstupenky</Link>
        </Button>
      </div>
    );
  }

  if (state === 'not_yet') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-5xl">⏰</p>
        <p className="text-xl font-bold">Stream ještě nezačal</p>
        <p className="text-sm text-gray-400">Stránka se automaticky obnoví každých 30 sekund.</p>
        <Button onClick={() => window.location.reload()} className="mt-2">Obnovit</Button>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-xl font-bold">Stream skončil</p>
        <p className="text-sm text-gray-400">Záznam není dostupný.</p>
        <Button asChild variant="outline" className="border-white text-white hover:bg-white/10">
          <Link href={`/${locale}/my-tickets`}>Moje vstupenky</Link>
        </Button>
      </div>
    );
  }

  if (state === 'error' || !data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black text-white">
        <p className="text-xl font-bold">Chyba</p>
        <p className="text-sm text-gray-400">{error ?? 'Nepodařilo se načíst stream.'}</p>
        <Button onClick={() => window.location.reload()}>Zkusit znovu</Button>
      </div>
    );
  }

  const ytId = extractYouTubeId(data.streaming_url);
  const vimeoId = !ytId ? extractVimeoId(data.streaming_url) : null;

  const embedSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`
    : vimeoId
    ? `https://player.vimeo.com/video/${vimeoId}?autoplay=1&color=ffffff`
    : null;

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2">
        <div>
          <p className="text-sm font-semibold">{data.event_title}</p>
          {data.is_replay ? (
            <span className="rounded bg-amber-500 px-2 py-0.5 text-xs font-bold text-black">REPLAY</span>
          ) : (
            <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold">● LIVE</span>
          )}
        </div>
        <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10">
          <Link href={`/${locale}/my-tickets`}>← Vstupenky</Link>
        </Button>
      </div>

      {/* Hlavní obsah */}
      <div className={`flex flex-1 overflow-hidden ${data.stream_chat_url ? 'flex-row' : ''}`}>
        {/* Video player */}
        <div className="relative flex-1 bg-black">
          {embedSrc ? (
            <iframe
              className="absolute inset-0 h-full w-full"
              src={embedSrc}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              title={data.event_title}
            />
          ) : (
            // Přímý URL (RTMP, vlastní player, HLS…)
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="mb-4 text-lg">Vlastní stream</p>
                <Button
                  onClick={() => window.open(data.streaming_url, '_blank', 'noopener')}
                  size="lg"
                >
                  Otevřít stream ↗
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Chat sidebar */}
        {data.stream_chat_url ? (
          <div className="hidden w-80 shrink-0 border-l border-white/10 md:block">
            <iframe
              className="h-full w-full"
              src={data.stream_chat_url}
              title="Live chat"
              allow="accelerometer; autoplay"
            />
          </div>
        ) : null}
      </div>

      {/* Replay info */}
      {data.is_replay && data.replay_expires_at ? (
        <div className="px-4 py-1 text-center text-xs text-gray-500">
          Replay dostupný do {new Date(data.replay_expires_at).toLocaleDateString('cs-CZ')}
        </div>
      ) : null}
    </div>
  );
}
