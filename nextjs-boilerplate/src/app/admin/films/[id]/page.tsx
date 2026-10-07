'use client';

import { useEffect, useState, type JSX } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Film {
  id: string; title: string; original_title: string | null;
  synopsis: string | null; poster_url: string | null; backdrop_url: string | null;
  trailer_url: string | null; duration_minutes: number; age_rating: string;
  genre: string[]; director: string | null; cast_main: string | null;
  language: string; original_language: string | null; release_year: number | null;
  imdb_id: string | null; distributor: string | null; status: string;
}
interface Screening {
  event_id: string; date_start: string; screening_format: string | null;
  screening_language: string | null; screen_name: string | null;
  screen_type: string | null; venue_name: string; venue_city: string;
  tickets_sold: number; slug: string;
}

const AGE_COLOR: Record<string, string> = {
  U:'bg-green-100 text-green-800','7':'bg-blue-100 text-blue-800',
  '12':'bg-yellow-100 text-yellow-800','15':'bg-orange-100 text-orange-800',
  '18':'bg-red-100 text-red-800',X:'bg-slate-900 text-white',
};
const FORMAT_LABEL: Record<string, string> = {
  '2d':'2D','3d':'3D','imax':'IMAX','4dx':'4DX',
  'dubbed':'Dabing','subtitled':'Titulky','original':'Originál',
  'dubbed_3d':'Dabing 3D','subtitled_3d':'Titulky 3D',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
}

export default function FilmDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [film, setFilm] = useState<Film | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Film>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function load() {
    setLoading(true);
    const r = await authFetch(`/api/admin/films/${id}`);
    if (r.ok) {
      const d = await r.json() as { film: Film; screenings: Screening[] };
      setFilm(d.film);
      setScreenings(d.screenings);
      setForm(d.film);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, [id]);

  async function save() {
    if (!film) return;
    setSaving(true);
    const r = await authFetch(`/api/admin/films/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        genre: typeof form.genre === 'string'
          ? (form.genre as string).split(',').map((g) => g.trim()).filter(Boolean)
          : form.genre,
      }),
    });
    if (r.ok) {
      const d = await r.json() as { film: Film };
      setFilm(d.film);
      setEditing(false);
      setFeedback('Uloženo.');
      setTimeout(() => setFeedback(''), 3000);
    }
    setSaving(false);
  }

  if (loading || !film) {
    return <p className="p-6 text-slate-400">Načítám…</p>;
  }

  const genreStr = Array.isArray(form.genre) ? form.genre.join(', ') : (form.genre ?? '');

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Breadcrumb */}
      <Link href="/admin/films" className="text-sm text-indigo-600 hover:underline">← Filmový katalog</Link>

      {feedback && (
        <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">{feedback}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Poster */}
        <div className="space-y-3">
          <div className="aspect-[2/3] rounded-xl overflow-hidden bg-slate-100 border">
            {film.poster_url ? (
              <img src={film.poster_url} alt={film.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-4xl">🎬</div>
            )}
          </div>
          {film.trailer_url && (
            <a href={film.trailer_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 border rounded-xl py-2 text-sm text-slate-700 hover:bg-slate-50">
              ▶ Trailer
            </a>
          )}
          <div className="flex gap-2">
            <span className={`text-sm px-2 py-1 rounded font-bold ${AGE_COLOR[film.age_rating] ?? 'bg-slate-100'}`}>
              {film.age_rating === 'U' ? 'U' : `${film.age_rating}+`}
            </span>
            <span className="text-sm border rounded px-2 py-1 text-slate-600">⏱ {film.duration_minutes} min</span>
          </div>
        </div>

        {/* Detail / Edit */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{film.title}</h1>
              {film.original_title && film.original_title !== film.title && (
                <p className="text-slate-400 text-sm">{film.original_title}</p>
              )}
            </div>
            <button onClick={() => setEditing(!editing)}
              className="text-sm border rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 shrink-0">
              {editing ? 'Zrušit' : '✏️ Upravit'}
            </button>
          </div>

          {editing ? (
            <div className="space-y-3">
              {([
                ['title', 'Název', 'text'],
                ['original_title', 'Originální název', 'text'],
                ['director', 'Režisér', 'text'],
                ['cast_main', 'Hlavní herci', 'text'],
                ['distributor', 'Distributor', 'text'],
                ['poster_url', 'URL plakátu', 'text'],
                ['backdrop_url', 'URL pozadí', 'text'],
                ['trailer_url', 'URL traileru', 'text'],
                ['imdb_id', 'IMDB ID', 'text'],
                ['duration_minutes', 'Délka (min)', 'number'],
                ['release_year', 'Rok vydání', 'number'],
              ] as [keyof Film, string, string][]).map(([key, label, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-700 mb-1">{label}</label>
                  <input type={type} value={(form[key] as string | number | null) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: type === 'number' ? +e.target.value : e.target.value }))}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Žánry (čárkou)</label>
                <input value={genreStr}
                  onChange={(e) => setForm((f) => ({ ...f, genre: e.target.value as unknown as string[] }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Věkové omezení</label>
                <select value={form.age_rating ?? 'U'}
                  onChange={(e) => setForm((f) => ({ ...f, age_rating: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  {['U','7','12','15','18','X'].map((r) => (
                    <option key={r} value={r}>{r === 'U' ? 'U (bez omezení)' : `${r}+`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Synopse</label>
                <textarea value={form.synopsis ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, synopsis: e.target.value }))}
                  rows={4} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={() => void save()} disabled={saving}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Ukládám…' : 'Uložit změny'}
              </button>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-700">
              {film.synopsis && <p className="text-slate-600">{film.synopsis}</p>}
              <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                {film.director   && <><span className="text-slate-400">Režisér</span><span>{film.director}</span></>}
                {film.cast_main  && <><span className="text-slate-400">Herci</span><span>{film.cast_main}</span></>}
                {film.distributor && <><span className="text-slate-400">Distributor</span><span>{film.distributor}</span></>}
                {film.release_year && <><span className="text-slate-400">Rok</span><span>{film.release_year}</span></>}
                {film.imdb_id    && <><span className="text-slate-400">IMDB</span><a href={`https://www.imdb.com/title/${film.imdb_id}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">{film.imdb_id}</a></>}
              </div>
              {film.genre.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {film.genre.map((g) => (
                    <span key={g} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{g}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Screenings */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-900">Promítání ({screenings.length})</h2>
          <Link href={`/admin/events/new?film_id=${film.id}`}
            className="text-sm bg-indigo-700 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-800">
            + Přidat promítání
          </Link>
        </div>
        {screenings.length === 0 ? (
          <div className="text-center py-10 text-slate-400 border rounded-xl">
            <div className="text-3xl mb-2">📅</div>
            <p className="text-sm">Žádná budoucí promítání. Vytvořte první promítání.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {screenings.map((s) => (
              <Link key={s.event_id} href={`/admin/events/${s.event_id}`}
                className="flex items-center gap-4 bg-white border rounded-xl px-4 py-3 hover:border-indigo-300 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900 text-sm">
                      {new Date(s.date_start).toLocaleDateString('cs-CZ', { weekday:'short', day:'numeric', month:'short' })}
                      {' '}
                      {new Date(s.date_start).toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' })}
                    </span>
                    {s.screening_format && (
                      <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                        {FORMAT_LABEL[s.screening_format] ?? s.screening_format}
                      </span>
                    )}
                    {s.screen_type === 'imax' && (
                      <span className="text-xs bg-blue-900 text-white px-2 py-0.5 rounded font-bold">IMAX</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {s.venue_name} · {s.venue_city}
                    {s.screen_name && ` · ${s.screen_name}`}
                    {s.tickets_sold > 0 && ` · ${s.tickets_sold} prodaných`}
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
