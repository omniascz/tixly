'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

interface MemoryData {
  ticket: {
    id: string;
    status: string;
    usedAt: string | null;
    commemorativeSentAt: string | null;
    ticketTypeName: string;
    seatLabel: string | null;
  };
  event: {
    id: string;
    title: string;
    dateStart: string | null;
  };
  venue: { name: string } | null;
  cast: Array<{ role_name: string; actor_name: string }>;
  template: {
    quote: string | null;
    themeColor: string;
    accentColor: string;
    customMessage: string | null;
  } | null;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function MemoryPage(): JSX.Element {
  const params = useParams();
  const searchParams = useSearchParams();
  const ticketId = String(params.ticketId);
  const queryToken = searchParams.get('token') ?? '';

  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const url = `/api/tickets/${ticketId}/memory${queryToken ? `?token=${encodeURIComponent(queryToken)}` : ''}`;
        const res = await authFetch(url);
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as MemoryData);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [ticketId, queryToken]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1a1a2e]">
        <p className="text-white/60 text-sm">Načítám vzpomínku…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#1a1a2e]">
        <p className="text-white/60 text-sm">{error ?? 'Vzpomínka nenalezena.'}</p>
      </div>
    );
  }

  const { ticket, event, venue, cast, template } = data;
  const themeColor = template?.themeColor ?? '#1a1a2e';
  const accentColor = template?.accentColor ?? '#e2b96f';
  const isUsed = ticket.status === 'used';

  async function handleShare() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Vzpomínka na ${event.title}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShareMsg('Odkaz zkopírován do schránky.');
        setTimeout(() => setShareMsg(null), 3000);
      }
    } catch {
      await navigator.clipboard.writeText(url).catch(() => null);
      setShareMsg('Odkaz zkopírován do schránky.');
      setTimeout(() => setShareMsg(null), 3000);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 print:p-0"
      style={{ backgroundColor: themeColor }}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl print:shadow-none print:rounded-none"
        style={{ backgroundColor: themeColor, border: `1px solid ${accentColor}33` }}
      >
        <div
          className="h-1.5 w-full"
          style={{ backgroundColor: accentColor }}
        />

        <div className="p-8 space-y-6">
          <div>
            <p
              className="text-xs tracking-widest uppercase mb-2"
              style={{ color: accentColor }}
            >
              Vzpomínka na večer
            </p>
            <h1
              className="font-serif text-4xl font-bold leading-tight text-white"
            >
              {event.title}
            </h1>
          </div>

          {!isUsed ? (
            <div
              className="rounded-lg p-4 text-sm"
              style={{ backgroundColor: `${accentColor}18`, border: `1px solid ${accentColor}44`, color: 'rgba(255,255,255,0.7)' }}
            >
              Vzpomínka bude dostupná po vašem vstupu na představení.
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {event.dateStart ? (
                  <p className="text-white/80 text-sm capitalize">
                    {formatDate(event.dateStart)}
                  </p>
                ) : null}
                {venue ? (
                  <p className="text-white/60 text-sm">{venue.name}</p>
                ) : null}
                {ticket.seatLabel ? (
                  <p className="text-white/50 text-xs tracking-wide">
                    Místo: {ticket.seatLabel}
                  </p>
                ) : null}
              </div>

              {template?.quote ? (
                <div
                  className="border-l-2 pl-4"
                  style={{ borderColor: accentColor }}
                >
                  <p
                    className="italic text-base leading-relaxed"
                    style={{ color: accentColor }}
                  >
                    &ldquo;{template.quote}&rdquo;
                  </p>
                </div>
              ) : null}

              {cast.length > 0 ? (
                <div>
                  <p
                    className="text-xs tracking-widest uppercase mb-3"
                    style={{ color: accentColor }}
                  >
                    Obsazení
                  </p>
                  <div className="space-y-1.5">
                    {cast.map((c, i) => (
                      <div key={i} className="flex items-baseline gap-2">
                        <span className="text-white/50 text-xs w-32 shrink-0">{c.role_name}</span>
                        <span
                          className="h-px flex-1"
                          style={{ backgroundColor: `${accentColor}33` }}
                        />
                        <span className="text-white/80 text-sm">{c.actor_name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {template?.customMessage ? (
                <p className="text-white/70 text-sm leading-relaxed">
                  {template.customMessage}
                </p>
              ) : null}
            </>
          )}

          <div
            className="pt-4"
            style={{ borderTop: `1px solid ${accentColor}22` }}
          >
            <div className="flex items-center justify-between">
              <div>
                {venue && event.dateStart ? (
                  <p className="text-white/40 text-xs">
                    {venue.name} · {new Date(event.dateStart).toLocaleDateString('cs-CZ')}
                  </p>
                ) : null}
                <p
                  className="text-xs font-medium tracking-widest mt-0.5"
                  style={{ color: `${accentColor}88` }}
                >
                  TIXLY
                </p>
              </div>
              {ticket.ticketTypeName ? (
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${accentColor}22`, color: accentColor }}
                >
                  {ticket.ticketTypeName}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {isUsed ? (
        <div className="mt-6 flex gap-3 print:hidden">
          <button
            onClick={() => { void handleShare(); }}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: accentColor, color: '#1a1a1a' }}
          >
            Sdílet vzpomínku
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium border transition-opacity hover:opacity-80"
            style={{ borderColor: `${accentColor}55`, color: accentColor }}
          >
            Stáhnout / tisknout
          </button>
        </div>
      ) : null}

      {shareMsg ? (
        <p className="mt-3 text-sm print:hidden" style={{ color: accentColor }}>
          {shareMsg}
        </p>
      ) : null}

      <style>{`
        @media print {
          body { background: ${themeColor}; }
          @page { margin: 0; }
        }
      `}</style>
    </div>
  );
}
