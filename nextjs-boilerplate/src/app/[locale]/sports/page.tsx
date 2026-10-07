'use client';

import { useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Match {
  event_id: string;
  title: string;
  slug: string | null;
  date_start: string;
  sport_type: string;
  competition: string | null;
  match_day: number | null;
  home_team_id: string;
  home_team_name: string | null;
  home_team_short: string | null;
  home_team_logo: string | null;
  home_color: string | null;
  away_team_id: string;
  away_team_name: string | null;
  away_team_short: string | null;
  away_team_logo: string | null;
  away_color: string | null;
  venue_name: string | null;
  venue_city: string | null;
  price_from: number | null;
  remaining_qty: number | null;
}

const SPORT_LABEL: Record<string, string> = {
  football:'⚽ Fotbal', hockey:'🏒 Hokej', basketball:'🏀 Basket',
  volleyball:'🏐 Volejbal', handball:'🤾 Házenou', tennis:'🎾 Tenis',
  athletics:'🏃 Atletika', mma:'🥊 MMA', motorsport:'🏎 Motorsport',
  esport:'🎮 Esport', other:'🏆 Jiný sport',
};

const SPORT_BG: Record<string, string> = {
  football:'from-green-800 to-green-900',
  hockey:'from-blue-800 to-blue-900',
  basketball:'from-orange-700 to-orange-900',
  volleyball:'from-yellow-600 to-yellow-800',
  handball:'from-red-700 to-red-900',
  mma:'from-slate-700 to-slate-900',
  esport:'from-purple-700 to-purple-900',
};

function formatMatchDate(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'short' }),
    time: d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
  };
}

export default function SportsPage(): JSX.Element {
  const { locale } = useParams<{ locale: string }>();
  const [matches, setMatches]     = useState<Match[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filterSport, setFilter]  = useState('');

  useEffect(() => {
    const qs = filterSport ? `?sport=${filterSport}&days=60` : '?days=60';
    fetch(`/api/sports/matches${qs}`)
      .then((r) => r.json())
      .then((d) => { setMatches((d as { matches: Match[] }).matches); setLoading(false); })
      .catch(() => setLoading(false));
  }, [filterSport]);

  const availableSports = [...new Set(matches.map((m) => m.sport_type))];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">🏆 Sportovní zápasy</h1>
        <p className="text-slate-500 text-sm mt-1">Vstupenky na zápasy online — vyberte svůj sport</p>
      </div>

      {/* Sport filters */}
      {!loading && availableSports.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFilter('')}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterSport === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 hover:border-slate-400'}`}>
            Vše
          </button>
          {availableSports.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterSport === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 hover:border-slate-400'}`}>
              {SPORT_LABEL[s] ?? s}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-5xl mb-4">🏆</div>
          <p className="text-slate-500">Momentálně žádné nadcházející zápasy.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((m) => {
            const { day, time } = formatMatchDate(m.date_start);
            const href = m.slug ? `/${locale}/events/${m.slug}` : `/${locale}/events/${m.event_id}`;
            const bg = SPORT_BG[m.sport_type] ?? 'from-slate-700 to-slate-900';

            return (
              <Link key={m.event_id} href={href}
                className="block bg-white border rounded-xl overflow-hidden hover:border-indigo-300 hover:shadow-md transition-all">
                <div className={`bg-gradient-to-r ${bg} px-4 py-1.5 flex items-center justify-between`}>
                  <span className="text-white text-xs font-medium">
                    {SPORT_LABEL[m.sport_type] ?? m.sport_type}
                    {m.competition && ` · ${m.competition}`}
                    {m.match_day && ` · ${m.match_day}. kolo`}
                  </span>
                  <span className="text-white/70 text-xs">{m.venue_city ?? ''}</span>
                </div>
                <div className="px-4 py-4 flex items-center gap-4">
                  {/* Date column */}
                  <div className="text-center w-16 flex-shrink-0">
                    <div className="text-xs text-slate-400">{day}</div>
                    <div className="text-lg font-bold text-slate-900">{time}</div>
                  </div>

                  {/* Match */}
                  <div className="flex-1 flex items-center gap-3">
                    {/* Home */}
                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <span className="font-semibold text-slate-900 text-sm text-right">
                        {m.home_team_short ?? m.home_team_name ?? '—'}
                      </span>
                      <TeamLogo logo={m.home_team_logo} color={m.home_color} size={36} />
                    </div>

                    <div className="text-slate-400 font-bold text-lg px-1">vs</div>

                    {/* Away */}
                    <div className="flex items-center gap-2 flex-1">
                      <TeamLogo logo={m.away_team_logo} color={m.away_color} size={36} />
                      <span className="font-semibold text-slate-900 text-sm">
                        {m.away_team_short ?? m.away_team_name ?? '—'}
                      </span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="text-right flex-shrink-0">
                    {m.remaining_qty === 0 ? (
                      <span className="text-xs text-red-600 font-medium">Vyprodáno</span>
                    ) : m.price_from != null ? (
                      <>
                        <div className="text-xs text-slate-400">od</div>
                        <div className="font-bold text-slate-900">{(m.price_from / 100).toFixed(0)} Kč</div>
                      </>
                    ) : (
                      <span className="text-xs text-indigo-700 font-medium">Koupit →</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamLogo({
  logo, color, size,
}: { logo: string | null; color: string | null; size: number }): JSX.Element {
  return (
    <div
      className="rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: color ?? '#e5e7eb' }}
    >
      {logo ? (
        <img src={logo} alt="" className="w-full h-full object-contain p-0.5" />
      ) : (
        <span className="text-xs text-white font-bold">?</span>
      )}
    </div>
  );
}
