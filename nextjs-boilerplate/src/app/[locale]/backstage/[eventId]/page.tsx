import { redirect } from 'next/navigation';
import { Pool } from 'pg';
import { Play } from 'lucide-react';
import { ShareButton } from './ShareButton';

interface BackstageMomentRow {
  event_id: string;
  video_url: string;
  thumbnail_url: string | null;
  title: string | null;
  description: string | null;
  notify_minutes_before: number;
}

interface EventRow {
  id: string;
  title: string;
  date_start: string;
  slug: string | null;
}

interface PageData {
  moment: BackstageMomentRow;
  event: EventRow;
}

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function extractVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? m[1] : null;
}

function minutesUntil(dateStr: string): number {
  return Math.max(0, Math.round((new Date(dateStr).getTime() - Date.now()) / 60_000));
}

async function fetchData(eventId: string): Promise<PageData | null> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [mRes, eRes] = await Promise.all([
      pool.query<BackstageMomentRow>(
        `SELECT event_id, video_url, thumbnail_url, title, description, notify_minutes_before
           FROM catalog.backstage_moments
          WHERE event_id = $1 AND is_active = true`,
        [eventId],
      ),
      pool.query<EventRow>(
        `SELECT id, title, date_start, slug
           FROM catalog.events
          WHERE id = $1`,
        [eventId],
      ),
    ]);
    if (mRes.rows.length === 0 || eRes.rows.length === 0) return null;
    return { moment: mRes.rows[0], event: eRes.rows[0] };
  } finally {
    await pool.end();
  }
}

export default async function BackstagePage({
  params,
}: {
  params: { locale: string; eventId: string };
}) {
  const data = await fetchData(params.eventId);

  if (!data) {
    redirect(`/${params.locale}/events`);
  }

  const { moment, event } = data;
  const mins = minutesUntil(event.date_start);

  const ytId = extractYouTubeId(moment.video_url);
  const vimeoId = !ytId ? extractVimeoId(moment.video_url) : null;
  const isDirectVideo = !ytId && !vimeoId;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const pageUrl = `${appUrl}/${params.locale}/backstage/${params.eventId}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-400">
          Backstage
        </p>
        <h1 className="mb-1 text-2xl font-bold leading-tight">
          {moment.title ?? 'Zákulisí dnešního večera'}
        </h1>
        <p className="mb-6 text-sm text-zinc-400">{event.title}</p>

        {mins > 0 && (
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-zinc-800 px-4 py-1.5 text-sm text-zinc-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            Za {mins} {mins === 1 ? 'minutu' : mins < 5 ? 'minuty' : 'minut'} začínáme
          </div>
        )}

        <div className="mb-6 overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl">
          {ytId ? (
            <div className="relative aspect-video">
              <iframe
                src={`https://www.youtube.com/embed/${ytId}?autoplay=0&rel=0`}
                title={moment.title ?? 'Backstage video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          ) : vimeoId ? (
            <div className="relative aspect-video">
              <iframe
                src={`https://player.vimeo.com/video/${vimeoId}`}
                title={moment.title ?? 'Backstage video'}
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          ) : isDirectVideo ? (
            <div className="relative">
              {moment.thumbnail_url && (
                <img
                  src={moment.thumbnail_url}
                  alt={moment.title ?? 'Náhled'}
                  className="w-full object-cover"
                />
              )}
              <video
                src={moment.video_url}
                controls
                poster={moment.thumbnail_url ?? undefined}
                className="w-full"
              />
            </div>
          ) : moment.thumbnail_url ? (
            <div className="relative aspect-video">
              <img
                src={moment.thumbnail_url}
                alt={moment.title ?? 'Náhled'}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <a
                  href={moment.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg transition hover:scale-105"
                >
                  <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
                </a>
              </div>
            </div>
          ) : (
            <a
              href={moment.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 p-6 text-sm text-zinc-300 hover:text-white"
            >
              <Play className="h-5 w-5" />
              Přehrát video
            </a>
          )}
        </div>

        {moment.description ? (
          <p className="mb-6 leading-relaxed text-zinc-300">{moment.description}</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <ShareButton
            title={moment.title ?? 'Zákulisí dnešního večera'}
            url={pageUrl}
          />

          {/* F1: odkaz na program-booklet odstranen — funkce smazana (FINDINGS 136) */}
        </div>
      </div>
    </div>
  );
}
