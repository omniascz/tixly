'use client';

import { useEffect, useState, useCallback } from 'react';
import { HeartHandshake, TrendingUp, Eye, MousePointer, CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';

function authFetch(path: string, opts: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(path, {
    ...opts,
    headers: {
      ...(opts.headers ?? {}),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

interface Proposal {
  id: string;
  status: string;
  fee_czk: number;
  impressions: number;
  clicks: number;
  placement: string[];
  proposed_at: string;
  responded_at: string | null;
  expires_at: string | null;
  event_id: string;
  event_title: string;
  date_start: string;
  venue_name: string | null;
  venue_city: string | null;
  campaign_id: string;
  campaign_name: string;
  tagline: string | null;
  campaign_logo: string | null;
  cta_text: string | null;
  cta_url: string | null;
  advertiser_name: string;
}

interface Summary {
  earned_czk: number;
  total_impressions: number;
  total_clicks: number;
  pending_count: number;
  active_count: number;
}

const STATUS_LABEL: Record<string, string> = {
  proposed: 'Čeká na odpověď',
  accepted: 'Přijato',
  active:   'Aktivní',
  declined: 'Odmítnuto',
  expired:  'Vypršelo',
  cancelled: 'Zrušeno',
};

const STATUS_COLOR: Record<string, string> = {
  proposed: 'bg-amber-50 text-amber-700 border-amber-200',
  accepted: 'bg-green-50 text-green-700 border-green-200',
  active:   'bg-blue-50 text-blue-700 border-blue-200',
  declined: 'bg-red-50 text-red-700 border-red-200',
  expired:  'bg-muted text-muted-foreground border-muted',
  cancelled: 'bg-muted text-muted-foreground border-muted',
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('cs-CZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function BrandConnectPage() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'proposed' | 'accepted' | 'all'>('proposed');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const r = await authFetch(`/api/admin/brand-connect/proposals?status=${status}`);
      const j = await r.json() as { proposals: Proposal[]; summary: Summary };
      setProposals(j.proposals ?? []);
      setSummary(j.summary ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [filter, load]);

  async function respond(id: string, action: 'accept' | 'decline') {
    setActing(id);
    try {
      const r = await authFetch(`/api/admin/brand-connect/proposals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
      if (!r.ok) {
        const j = await r.json() as { error?: string };
        setError(j.error ?? 'Chyba');
        return;
      }
      await load(filter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 text-white">
          <HeartHandshake className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Brand Connect</h1>
          <p className="text-sm text-muted-foreground">
            Partnerství se značkami — nechte si zaplatit za umístění reklamy na vašich akcích
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><TrendingUp className="h-3 w-3" />Vydělané</div>
            <div className="text-xl font-bold">{summary.earned_czk.toLocaleString('cs-CZ')} Kč</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="h-3 w-3" />Čekající</div>
            <div className="text-xl font-bold">{summary.pending_count}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Eye className="h-3 w-3" />Zobrazení</div>
            <div className="text-xl font-bold">{summary.total_impressions.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MousePointer className="h-3 w-3" />Kliky</div>
            <div className="text-xl font-bold">{summary.total_clicks.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border-b">
        {(['proposed','accepted','all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === s
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'proposed' ? `Návrhy${summary?.pending_count ? ` (${summary.pending_count})` : ''}` :
             s === 'accepted' ? `Přijatá (${summary?.active_count ?? 0})` :
             'Vše'}
          </button>
        ))}
      </div>

      {/* Proposals list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map((i) => (
            <div key={i} className="rounded-lg border p-4 animate-pulse h-24 bg-muted/30" />
          ))}
        </div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <HeartHandshake className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Žádné návrhy</p>
          <p className="text-sm mt-1">Brand Connect návrhy od inzerentů se zobrazí zde</p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border bg-card overflow-hidden"
            >
              {/* Main row */}
              <div className="p-4 flex items-start gap-4">
                {/* Brand logo */}
                <div className="flex-shrink-0">
                  {p.campaign_logo ? (
                    <img src={p.campaign_logo} alt={p.advertiser_name} className="h-12 w-12 rounded-lg object-contain border" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                      {p.advertiser_name[0]}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{p.advertiser_name}</span>
                    <span className="text-muted-foreground text-sm">·</span>
                    <span className="text-sm text-muted-foreground">{p.campaign_name}</span>
                    <span className={`text-[10px] rounded-full border px-2 py-0.5 font-medium ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>

                  {p.tagline && (
                    <p className="text-sm text-muted-foreground mt-0.5 truncate">{p.tagline}</p>
                  )}

                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    <span>📅 {p.event_title} — {fmtDate(p.date_start)}</span>
                    {p.venue_city && <span>📍 {p.venue_city}</span>}
                    <span className="font-semibold text-foreground">{p.fee_czk.toLocaleString('cs-CZ')} Kč</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {p.status === 'proposed' && (
                    <>
                      <button
                        onClick={() => void respond(p.id, 'decline')}
                        disabled={acting === p.id}
                        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Odmítnout
                      </button>
                      <button
                        onClick={() => void respond(p.id, 'accept')}
                        disabled={acting === p.id}
                        className="flex items-center gap-1 rounded-md bg-green-600 text-white px-3 py-1.5 text-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Přijmout
                      </button>
                    </>
                  )}
                  {(p.status === 'accepted' || p.status === 'active') && (
                    <div className="text-xs text-muted-foreground text-right">
                      <div>{p.impressions} zobrazení</div>
                      <div>{p.clicks} kliků</div>
                    </div>
                  )}
                  <button
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                    className="text-muted-foreground hover:text-foreground p-1"
                  >
                    {expanded === p.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === p.id && (
                <div className="border-t bg-muted/20 p-4 text-sm space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Kampaň</div>
                      <div>{p.campaign_name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Inzerent</div>
                      <div>{p.advertiser_name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Honorář</div>
                      <div className="font-semibold">{p.fee_czk.toLocaleString('cs-CZ')} Kč</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Umístění</div>
                      <div>{p.placement.join(', ')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Navrženo</div>
                      <div>{fmtDate(p.proposed_at)}</div>
                    </div>
                    {p.expires_at && (
                      <div>
                        <div className="text-xs text-muted-foreground">Platnost nabídky do</div>
                        <div>{fmtDate(p.expires_at)}</div>
                      </div>
                    )}
                  </div>
                  {p.cta_url && (
                    <div className="pt-1">
                      <a
                        href={p.cta_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {p.cta_text ?? 'Zjistit více'} →
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
