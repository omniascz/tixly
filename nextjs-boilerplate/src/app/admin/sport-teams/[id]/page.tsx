'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Team {
  id: string; name: string; short_name: string | null; code: string | null;
  sport_type: string; logo_url: string | null; primary_color: string | null;
  secondary_color: string | null; city: string | null; country: string;
  league_name: string | null; league_country: string | null;
  founded_year: number | null; website_url: string | null;
  stadium_name: string | null; status: string;
}
interface Match {
  id: string; title: string; date_start: string; status: string;
  competition: string | null; match_day: number | null; is_home_match: boolean | null;
  home_team_name: string | null; home_team_logo: string | null;
  away_team_name: string | null; away_team_logo: string | null;
  venue_name: string | null; venue_city: string | null;
  tickets_sold: number;
}

const SPORT_LABEL: Record<string, string> = {
  football:'⚽ Fotbal', hockey:'🏒 Hokej', basketball:'🏀 Basket',
  volleyball:'🏐 Volejbal', handball:'🤾 Házenou', tennis:'🎾 Tenis',
  athletics:'🏃 Atletika', mma:'🥊 MMA', motorsport:'🏎 Motorsport',
  esport:'🎮 Esport', other:'🏆 Jiný',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

export default function SportTeamDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam]       = useState<Team | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState<Partial<Team>>({});
  const [saving, setSaving]   = useState(false);
  const [feedback, setFeedback] = useState('');

  async function load() {
    setLoading(true);
    const r = await authFetch(`/api/admin/sport-teams/${id}`);
    if (r.ok) {
      const d = await r.json() as { team: Team; matches: Match[] };
      setTeam(d.team);
      setMatches(d.matches);
      setForm(d.team);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [id]);

  async function save() {
    setSaving(true);
    const r = await authFetch(`/api/admin/sport-teams/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (r.ok) {
      const d = await r.json() as { team: Team };
      setTeam(d.team);
      setEditing(false);
      setFeedback('Uloženo.');
      setTimeout(() => setFeedback(''), 3000);
    }
    setSaving(false);
  }

  if (loading || !team) return <p className="p-6 text-slate-400">Načítám…</p>;

  const homeMatches  = matches.filter((m) => m.is_home_match);
  const awayMatches  = matches.filter((m) => !m.is_home_match);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Link href="/admin/sport-teams" className="text-sm text-indigo-600 hover:underline">← Sportovní týmy</Link>

      {feedback && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">{feedback}</div>
      )}

      {/* Team header */}
      <div className="bg-white border rounded-xl p-5">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: team.primary_color ?? '#e5e7eb' }}>
            {team.logo_url ? (
              <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain p-2" />
            ) : (
              <span className="text-3xl">{SPORT_LABEL[team.sport_type]?.split(' ')[0] ?? '🏆'}</span>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{team.name}</h1>
              {team.code && (
                <span className="text-sm font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{team.code}</span>
              )}
            </div>
            <div className="flex gap-3 mt-1 text-sm text-slate-500 flex-wrap">
              <span>{SPORT_LABEL[team.sport_type] ?? team.sport_type}</span>
              {team.city && <span>📍 {team.city}</span>}
              {team.league_name && <span>🏆 {team.league_name}</span>}
              {team.stadium_name && <span>🏟 {team.stadium_name}</span>}
            </div>
          </div>
          <button onClick={() => setEditing(!editing)}
            className="text-sm border rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50">
            {editing ? 'Zrušit' : '✏️ Upravit'}
          </button>
        </div>

        {editing && (
          <div className="mt-5 pt-5 border-t space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {([
                ['name', 'Název *', 'text'],
                ['short_name', 'Zkrácený název', 'text'],
                ['code', 'Kód (3–4)', 'text'],
                ['city', 'Město', 'text'],
                ['league_name', 'Soutěž / liga', 'text'],
                ['league_country', 'Země ligy', 'text'],
                ['stadium_name', 'Stadion / aréna', 'text'],
                ['website_url', 'Web týmu', 'text'],
                ['logo_url', 'URL loga', 'text'],
                ['founded_year', 'Rok vzniku', 'number'],
              ] as [keyof Team, string, string][]).map(([key, label, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                  <input type={type}
                    value={(form[key] as string | number | null) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Hlavní barva</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.primary_color ?? '#000000'}
                    onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                    className="w-10 h-10 rounded border cursor-pointer" />
                  <input value={form.primary_color ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Druhá barva</label>
                <div className="flex gap-2 items-center">
                  <input type="color" value={form.secondary_color ?? '#ffffff'}
                    onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
                    className="w-10 h-10 rounded border cursor-pointer" />
                  <input value={form.secondary_color ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, secondary_color: e.target.value }))}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" />
                </div>
              </div>
            </div>
            <button onClick={() => void save()} disabled={saving || !form.name}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Ukládám…' : 'Uložit změny'}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Zápasů celkem', value: matches.length },
          { label: 'Domácích', value: homeMatches.length },
          { label: 'Venkovních', value: awayMatches.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white border rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-slate-900">{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Matches */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Zápasy ({matches.length})</h2>
          <Link href={`/admin/events/new?home_team_id=${team.id}`}
            className="text-sm bg-indigo-700 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-800">
            + Přidat zápas
          </Link>
        </div>
        {matches.length === 0 ? (
          <div className="text-center py-10 text-slate-400 border rounded-xl">
            <div className="text-3xl mb-2">📅</div>
            <p className="text-sm">Žádné nadcházející zápasy. Vytvořte první zápas.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {matches.map((m) => (
              <Link key={m.id} href={`/admin/events/${m.id}`}
                className="flex items-center gap-4 bg-white border rounded-xl px-4 py-3 hover:border-indigo-300 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 text-sm">
                      {new Date(m.date_start).toLocaleDateString('cs-CZ', { weekday:'short', day:'numeric', month:'short' })}
                      {' '}
                      {new Date(m.date_start).toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' })}
                    </span>
                    {m.is_home_match !== null && (
                      <span className={`text-xs px-2 py-0.5 rounded ${m.is_home_match ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                        {m.is_home_match ? 'Domácí' : 'Venkovní'}
                      </span>
                    )}
                    {m.competition && <span className="text-xs text-slate-400">{m.competition}</span>}
                    {m.match_day && <span className="text-xs text-slate-400">{m.match_day}. kolo</span>}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {m.home_team_name} vs {m.away_team_name}
                    {m.venue_name && ` · ${m.venue_name}`}
                    {m.tickets_sold > 0 && ` · ${m.tickets_sold} prodaných`}
                  </div>
                </div>
                <span className="text-slate-400 text-sm">→</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
