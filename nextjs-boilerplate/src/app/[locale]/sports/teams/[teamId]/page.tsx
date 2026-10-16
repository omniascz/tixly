'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Team {
  id: string; name: string; short_name: string | null; code: string | null;
  sport_type: string; logo_url: string | null; primary_color: string | null;
  secondary_color: string | null; city: string | null; country: string;
  league_name: string | null; founded_year: number | null;
  website_url: string | null; stadium_name: string | null;
}
interface Match {
  event_id: string; title: string; slug: string | null; date_start: string;
  competition: string | null; match_day: number | null; is_home_match: boolean | null;
  home_team_id: string; home_team_name: string | null; home_short: string | null; home_logo: string | null; home_color: string | null;
  away_team_id: string; away_team_name: string | null; away_short: string | null; away_logo: string | null; away_color: string | null;
  venue_name: string | null; venue_city: string | null;
  price_from: number | null; remaining_qty: number | null;
}

const SPORT_LABEL: Record<string, string> = {
  football:'⚽ Fotbal', hockey:'🏒 Hokej', basketball:'🏀 Basket',
  volleyball:'🏐 Volejbal', handball:'🤾 Házenou', tennis:'🎾 Tenis',
  athletics:'🏃 Atletika', mma:'🥊 MMA', motorsport:'🏎 Motorsport',
  esport:'🎮 Esport', other:'🏆 Jiný sport',
};

export default function TeamProfilePage(): JSX.Element {
  const { teamId, locale } = useParams<{ teamId: string; locale: string }>();
  const [team, setTeam]     = useState<Team | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/sports/teams/${teamId}`)
      .then((r) => r.json())
      .then((d) => {
        const data = d as { team: Team; matches: Match[] };
        setTeam(data.team);
        setMatches(data.matches);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [teamId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-32 bg-slate-100 rounded-xl mb-6" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🏆</div>
        <p className="text-slate-500">Tým nebyl nalezen.</p>
        <Link href={`/${locale}/sports`} className="mt-4 inline-block text-indigo-700 hover:underline">← Zpět na zápasy</Link>
      </div>
    );
  }

  const homeMatches = matches.filter((m) => m.is_home_match);
  const awayMatches = matches.filter((m) => !m.is_home_match);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <Link href={`/${locale}/sports`} className="text-sm text-indigo-700 hover:underline">← Všechny zápasy</Link>

      {/* Team hero */}
      <div className="rounded-2xl overflow-hidden border">
        <div className="h-24 bg-gradient-to-r from-slate-800 to-slate-900"
          style={{ background: team.primary_color ? `linear-gradient(135deg, ${team.primary_color}, ${team.secondary_color ?? '#1e293b'})` : undefined }} />
        <div className="px-6 pb-5 relative">
          <div className="w-20 h-20 rounded-xl overflow-hidden border-4 border-white bg-white -mt-10 mb-3 shadow-lg flex items-center justify-center"
            style={{ backgroundColor: team.primary_color ?? '#e5e7eb' }}>
            {team.logo_url ? (
              <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain p-1" />
            ) : (
              <span className="text-3xl">{SPORT_LABEL[team.sport_type]?.split(' ')[0] ?? '🏆'}</span>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{team.name}</h1>
              <div className="flex gap-3 mt-1 text-sm text-slate-500 flex-wrap">
                <span>{SPORT_LABEL[team.sport_type] ?? team.sport_type}</span>
                {team.city && <span>📍 {team.city}</span>}
                {team.league_name && <span>🏆 {team.league_name}</span>}
                {team.founded_year && <span>est. {team.founded_year}</span>}
              </div>
            </div>
            {team.website_url && (
              <a href={team.website_url} target="_blank" rel="noopener noreferrer"
                className="text-sm border rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                Web →
              </a>
            )}
          </div>
          {team.stadium_name && (
            <div className="mt-2 text-sm text-slate-500">🏟 {team.stadium_name}</div>
          )}
        </div>
      </div>

      {/* Match stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Celkem zápasů', value: matches.length },
          { label: 'Domácích', value: homeMatches.length },
          { label: 'Venkovních', value: awayMatches.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Upcoming matches */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-3">
          Nadcházející zápasy ({matches.length})
        </h2>
        {matches.length === 0 ? (
          <div className="text-center py-10 border rounded-xl text-slate-400">
            <p>Momentálně žádné nadcházející zápasy.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {matches.map((m) => {
              const href = m.slug ? `/${locale}/events/${m.slug}` : `/${locale}/events/${m.event_id}`;
              const d = new Date(m.date_start);
              return (
                <Link key={m.event_id} href={href}
                  className="flex items-center gap-4 bg-white border rounded-xl px-4 py-3.5 hover:border-indigo-300 hover:shadow-sm transition-all">
                  {/* Date */}
                  <div className="text-center w-14 flex-shrink-0">
                    <div className="text-xs text-slate-400">
                      {d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short' })}
                    </div>
                    <div className="font-bold text-slate-900">
                      {d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  {/* Match */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: m.home_color ?? '#e5e7eb' }}>
                        {m.home_logo
                          ? <img src={m.home_logo} className="w-full h-full object-contain p-0.5" alt="" />
                          : null}
                      </div>
                      <span className="text-sm font-medium text-slate-900">{m.home_short ?? m.home_team_name ?? '?'}</span>
                      <span className="text-xs text-slate-400">vs</span>
                      <span className="text-sm font-medium text-slate-900">{m.away_short ?? m.away_team_name ?? '?'}</span>
                      <div className="w-7 h-7 rounded flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: m.away_color ?? '#e5e7eb' }}>
                        {m.away_logo
                          ? <img src={m.away_logo} className="w-full h-full object-contain p-0.5" alt="" />
                          : null}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex gap-2 flex-wrap">
                      {m.is_home_match !== null && (
                        <span className={m.is_home_match ? 'text-green-600' : 'text-amber-600'}>
                          {m.is_home_match ? 'Domácí' : 'Venkovní'}
                        </span>
                      )}
                      {m.competition && <span>{m.competition}</span>}
                      {m.match_day && <span>{m.match_day}. kolo</span>}
                      {m.venue_name && <span>{m.venue_name}</span>}
                    </div>
                  </div>

                  {/* Price */}
                  <div className="text-right flex-shrink-0">
                    {m.remaining_qty === 0 ? (
                      <span className="text-xs text-red-600 font-medium">Vyprodáno</span>
                    ) : m.price_from != null ? (
                      <div className="font-semibold text-slate-900 text-sm">
                        od {(m.price_from / 100).toFixed(0)} Kč
                      </div>
                    ) : (
                      <span className="text-xs text-indigo-700">→</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
