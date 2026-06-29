'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Team {
  id: string;
  name: string;
  short_name: string | null;
  code: string | null;
  sport_type: string;
  logo_url: string | null;
  primary_color: string | null;
  city: string | null;
  country: string;
  league_name: string | null;
  status: string;
}

const SPORT_LABEL: Record<string, string> = {
  football:'⚽ Fotbal', hockey:'🏒 Hokej', basketball:'🏀 Basket',
  volleyball:'🏐 Volejbal', handball:'🤾 Házenou', tennis:'🎾 Tenis',
  athletics:'🏃 Atletika', mma:'🥊 MMA', motorsport:'🏎 Motorsport',
  esport:'🎮 Esport', other:'🏆 Jiný sport',
};

const SPORTS = Object.keys(SPORT_LABEL);

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

export default function SportTeamsPage(): JSX.Element {
  const [teams, setTeams]       = useState<Team[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filterSport, setFilter] = useState('');
  const [showNew, setShowNew]   = useState(false);
  const [form, setForm]         = useState({
    name: '', short_name: '', code: '', sport_type: 'football',
    logo_url: '', primary_color: '#000000', city: '', league_name: '', stadium_name: '',
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const qs = filterSport ? `?sport=${filterSport}` : '';
    const r = await authFetch(`/api/admin/sport-teams${qs}`);
    if (r.ok) { const d = await r.json() as { teams: Team[] }; setTeams(d.teams); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [filterSport]);

  async function createTeam() {
    if (!form.name.trim()) return;
    setSaving(true);
    const r = await authFetch('/api/admin/sport-teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (r.ok) {
      await load();
      setShowNew(false);
      setForm({ name:'',short_name:'',code:'',sport_type:'football',logo_url:'',primary_color:'#000000',city:'',league_name:'',stadium_name:'' });
    }
    setSaving(false);
  }

  const grouped: Record<string, Team[]> = {};
  for (const t of teams) {
    (grouped[t.sport_type] ??= []).push(t);
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">🏆 Sportovní týmy</h1>
          <p className="text-slate-500 text-sm mt-1">Správa týmů a prodej vstupenek na zápasy</p>
        </div>
        <button onClick={() => setShowNew(!showNew)}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800">
          + Přidat tým
        </button>
      </div>

      {/* Sport filter */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')}
          className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterSport === '' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 hover:border-slate-400'}`}>
          Vše
        </button>
        {SPORTS.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${filterSport === s ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 hover:border-slate-400'}`}>
            {SPORT_LABEL[s]}
          </button>
        ))}
      </div>

      {/* New team form */}
      {showNew && (
        <div className="bg-slate-50 border rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Nový tým</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Název * (např. AC Sparta Praha)</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="AC Sparta Praha" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Zkrácený název</label>
              <input value={form.short_name} onChange={(e) => setForm((f) => ({ ...f, short_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Sparta" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Kód (3–4 znaky)</label>
              <input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().slice(0, 4) }))}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono" placeholder="SPA" maxLength={4} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Sport</label>
              <select value={form.sport_type} onChange={(e) => setForm((f) => ({ ...f, sport_type: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                {SPORTS.map((s) => <option key={s} value={s}>{SPORT_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Barva týmu</label>
              <div className="flex gap-2 items-center">
                <input type="color" value={form.primary_color}
                  onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="w-10 h-10 rounded border cursor-pointer" />
                <input value={form.primary_color} onChange={(e) => setForm((f) => ({ ...f, primary_color: e.target.value }))}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm font-mono" placeholder="#AC0000" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Město</label>
              <input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Praha" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Soutěž / liga</label>
              <input value={form.league_name} onChange={(e) => setForm((f) => ({ ...f, league_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Fortuna liga" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Stadion / aréna</label>
              <input value={form.stadium_name} onChange={(e) => setForm((f) => ({ ...f, stadium_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Generali Arena" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">URL loga</label>
              <input value={form.logo_url} onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="https://..." />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void createTeam()} disabled={saving || !form.name}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Ukládám…' : 'Vytvořit tým'}
            </button>
            <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg text-sm border text-slate-600">
              Zrušit
            </button>
          </div>
        </div>
      )}

      {/* Teams grouped by sport */}
      {loading ? (
        <p className="text-slate-400 text-sm">Načítám…</p>
      ) : teams.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🏆</div>
          <p className="text-slate-500">Zatím žádné týmy. Přidejte první tým výše.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([sport, sportTeams]) => (
            <div key={sport}>
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-2">
                {SPORT_LABEL[sport] ?? sport}
              </h3>
              <div className="grid gap-2">
                {sportTeams.map((team) => (
                  <Link key={team.id} href={`/admin/sport-teams/${team.id}`}
                    className="bg-white border rounded-xl p-4 flex items-center gap-4 hover:border-slate-400 transition-colors">
                    {/* Logo / color swatch */}
                    <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: team.primary_color ?? '#e5e7eb' }}>
                      {team.logo_url ? (
                        <img src={team.logo_url} alt={team.name} className="w-full h-full object-contain p-1" />
                      ) : (
                        <span className="text-2xl">{SPORT_LABEL[team.sport_type]?.split(' ')[0] ?? '🏆'}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{team.name}</span>
                        {team.code && (
                          <span className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{team.code}</span>
                        )}
                        {team.status !== 'active' && (
                          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{team.status}</span>
                        )}
                      </div>
                      <div className="flex gap-3 mt-0.5 text-xs text-slate-500 flex-wrap">
                        {team.city && <span>📍 {team.city}</span>}
                        {team.league_name && <span>{team.league_name}</span>}
                      </div>
                    </div>
                    <div className="text-slate-400 text-sm">→</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
